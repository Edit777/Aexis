/**
 * cart-gift.js
 *
 * Custom element <cart-drawer-gift> — automatic free-gift management for the cart drawer.
 *
 * HOW IT WORKS
 * ─────────────
 * The element is rendered by snippets/cart-gift.liquid with two key data attributes:
 *   • data-id        — Shopify variant ID of the gift product
 *   • data-selected  — "true" | "false" (server-rendered initial state)
 *   • data-threshold — optional spend threshold in cents; when present the element
 *                      re-evaluates unlock state on every cart update client-side
 *
 * On every cart update (via PUB_SUB_EVENTS.cartUpdate) the element:
 *   1. Re-evaluates whether the threshold has been met from the cartData payload.
 *   2. If threshold MET and gift not already in cart → POST /cart/add.js (qty 1, _gift property).
 *   3. If threshold NOT MET and gift IS in cart   → POST /cart/change.js (qty 0 to remove).
 *   4. After any add/remove, re-renders the cart drawer via the section API.
 *
 * MERCHANT SETUP REQUIREMENTS
 * ─────────────────────────────
 * 1. Create a Shopify automatic discount in Admin → Discounts:
 *      "Buy X get Y" — set the gift product as the free item.
 *    This ensures the cart shows $0 (or compare-at price crossed out as "FREE").
 *
 * 2. The gift product variant must have compare_at_price > 0 so the theme can
 *    render the struck-through "was" price alongside the FREE badge.
 *
 * 3. The _gift: true line property (added by this file on /cart/add.js calls)
 *    is used by cart-drawer CSS to hide the line item from the items table
 *    (via `.cart-item--product-{{ product.handle }} { display: none; }` in
 *    the cart-gift.liquid snippet), preventing the gift from showing twice.
 *
 * DEPENDENCIES (already on the page via cart-drawer snippet)
 * ───────────────────────────────────────────────────────────
 *   • pubsub.js      — subscribe / publish / PUB_SUB_EVENTS
 *   • constants.js   — PUB_SUB_EVENTS.cartUpdate === 'cart-update'
 */

if (!customElements.get('cart-drawer-gift')) {
  class CartDrawerGift extends HTMLElement {
    connectedCallback() {
      this.variantId  = parseInt(this.dataset.id, 10);
      // Cache the cart-drawer element once; used by both add and remove methods.
      this.cartDrawer = document.querySelector('cart-drawer');

      // Subscribe to cart updates to keep gift state in sync.
      this._onCartUpdate = ({ cartData } = {}) => {
        if (cartData) this._syncGift(cartData);
      };
      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, this._onCartUpdate);

      // Variant picker: when the merchant enables variant selection, sync the
      // chosen variant ID so the correct variant is added as the gift.
      this._variantPicker = this.querySelector('.upsell__variant-picker');
      if (this._variantPicker) {
        this._onVariantChange = (event) => {
          if (event.target.closest('.variant-dropdown')) {
            this._updateVariantFromPicker(this._variantPicker);
          }
        };
        this._variantPicker.addEventListener('change', this._onVariantChange);
      }

      // Add-to-cart button (rendered inside <product-form> in the unlocked state).
      // The form's native submit is used for non-gift items; we intercept here.
      this._submitBtn = this.querySelector('[id$="-submit"]');
      if (this._submitBtn) {
        this._onSubmitClick = (event) => {
          event.preventDefault();
          this._addGiftToCart();
        };
        this._submitBtn.addEventListener('click', this._onSubmitClick);
      }
    }

    disconnectedCallback() {
      if (this.unsubscribe) this.unsubscribe();
      if (this._variantPicker && this._onVariantChange) {
        this._variantPicker.removeEventListener('change', this._onVariantChange);
      }
      if (this._submitBtn && this._onSubmitClick) {
        this._submitBtn.removeEventListener('click', this._onSubmitClick);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Sync — called on every cart update event
    // ─────────────────────────────────────────────────────────────

    _syncGift(cartData) {
      // Use items_subtotal_price (in cents) to evaluate spend threshold.
      const subtotal = cartData.items_subtotal_price ?? cartData.total_price ?? 0;

      // Compute unlock state: re-derive from data-threshold if present;
      // otherwise honour the current data-selected value (set by Liquid on load
      // and by _updateUI on subsequent updates).
      let unlocked = this.dataset.selected === 'true';
      if (this.dataset.threshold) {
        unlocked = subtotal >= parseInt(this.dataset.threshold, 10);
      }

      // Optimistically reflect the new state before any async mutation.
      this._updateUI(unlocked);

      const giftInCart = this._giftIsInCart(cartData);

      if (unlocked && !giftInCart) {
        this._addGiftToCart();
      } else if (!unlocked && giftInCart) {
        this._removeGiftFromCart();
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Cart mutation helpers
    // ─────────────────────────────────────────────────────────────

    async _addGiftToCart() {
      if (this._busy) return;
      this._busy = true;

      try {
        const formData = new FormData();
        formData.append('id',       this.variantId);
        formData.append('quantity', 1);
        formData.append('properties[_gift]', 'true');

        const sectionIds = this._getSectionIds();
        if (sectionIds) {
          formData.append('sections',     sectionIds);
          formData.append('sections_url', window.location.pathname);
        }

        const resp = await fetch(routes.cart_add_url, {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'X-Requested-With': 'XMLHttpRequest' },
          body:        formData,
        });

        if (!resp.ok) return;

        const cartData = await resp.json();
        this._updateUI(true);
        if (this.cartDrawer) this.cartDrawer.renderContents(cartData);
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-gift', cartData, variantId: this.variantId });
      } catch (_) {
        // Gift add is non-critical — fail silently
      } finally {
        this._busy = false;
      }
    }

    async _removeGiftFromCart() {
      if (this._busy) return;
      this._busy = true;

      try {
        const resp = await fetch(routes.cart_change_url, {
          method:      'POST',
          credentials: 'same-origin',
          headers:     {
            'Content-Type':     'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            id:           this.variantId,
            quantity:     0,
            sections:     this._getSectionIds(),
            sections_url: window.location.pathname,
          }),
        });

        if (!resp.ok) return;

        const cartData = await resp.json();
        this._updateUI(false);
        if (this.cartDrawer) this.cartDrawer.renderContents(cartData);
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-gift', cartData, variantId: this.variantId });
      } catch (_) {
        // Gift remove is non-critical — fail silently
      } finally {
        this._busy = false;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    /** Returns the section IDs string required by the Shopify section rendering API. */
    _getSectionIds() {
      return this.cartDrawer
        ? this.cartDrawer.getSectionsToRender().map((s) => s.id).join(',')
        : '';
    }

    _updateUI(unlocked) {
      this.dataset.selected = String(unlocked);
      // CSS drives locked/unlocked visuals via [data-selected="true"|"false"]
    }

    _updateVariantFromPicker(picker) {
      const variantJson = picker.querySelector('script[type="application/json"]');
      if (!variantJson) return;

      try {
        const variants = JSON.parse(variantJson.textContent);
        const chosen   = [...picker.querySelectorAll('select.variant-dropdown')].map((s) => s.value);
        const match    = variants.find((v) => v.options.every((opt, i) => opt === chosen[i]));
        if (match) this.variantId = match.id;
      } catch (_) {
        // Ignore JSON parse errors
      }
    }

    _giftIsInCart(cartData) {
      return (cartData.items || []).some(
        (item) =>
          item.variant_id === this.variantId &&
          item.properties?.['_gift'] === 'true'
      );
    }
  }

  customElements.define('cart-drawer-gift', CartDrawerGift);
}
