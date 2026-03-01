/**
 * cart-gift.js
 *
 * Custom element <cart-drawer-gift> — automatic free-gift management for the cart drawer.
 *
 * HOW IT WORKS
 * ─────────────
 * The element is rendered by snippets/cart-gift.liquid with two key data attributes:
 *   • data-id       — Shopify variant ID of the gift product
 *   • data-selected — "true" | "false" (server-rendered initial state)
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
      this.variantId  = parseInt(this.dataset.id,       10);
      // data-selected is the server-rendered initial locked/unlocked state
      this.isUnlocked = this.dataset.selected === 'true';

      // Subscribe to cart updates to keep gift state in sync
      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, ({ cartData } = {}) => {
        if (!cartData) return;
        this._syncGift(cartData);
      });

      // Variant picker: when the merchant enables variant selection, sync the
      // chosen variant ID so the correct variant is added as the gift.
      const variantPicker = this.querySelector('.upsell__variant-picker');
      if (variantPicker) {
        variantPicker.addEventListener('change', (event) => {
          const select = event.target;
          if (!select.closest('.variant-dropdown')) return;
          this._updateVariantFromPicker(variantPicker);
        });
      }

      // Add-to-cart button (rendered inside <product-form> in the unlocked state).
      // The form's native submit is used for non-gift items; we intercept here.
      const submitBtn = this.querySelector('[id$="-submit"]');
      if (submitBtn) {
        submitBtn.addEventListener('click', (event) => {
          event.preventDefault();
          this._addGiftToCart();
        });
      }
    }

    disconnectedCallback() {
      if (this.unsubscribe) this.unsubscribe();
    }

    // ─────────────────────────────────────────────────────────────
    // Sync — called on every cart update event
    // ─────────────────────────────────────────────────────────────

    _syncGift(cartData) {
      const wasUnlocked = this.isUnlocked;
      // The cartData from PUB_SUB_EVENTS.cartUpdate is the full cart JSON
      // returned by /cart/add.js or the section render payload.
      // Use items_subtotal_price (in cents) to evaluate spend threshold.
      const subtotal = cartData.items_subtotal_price ?? cartData.total_price ?? 0;

      // Re-evaluate server threshold. The Liquid already computed this on page
      // load via data-selected; on client updates we re-derive from the element's
      // sibling threshold data if present, otherwise trust data-selected toggling.
      // data-threshold (cents) is optionally stamped by cart-gift.liquid.
      if (this.dataset.threshold) {
        const threshold  = parseInt(this.dataset.threshold, 10);
        this.isUnlocked  = subtotal >= threshold;
      }

      const giftInCart = this._giftIsInCart(cartData);

      if (this.isUnlocked && !giftInCart) {
        this._addGiftToCart();
      } else if (!this.isUnlocked && giftInCart) {
        this._removeGiftFromCart();
      } else {
        // State unchanged — just update the visual locked/unlocked classes
        // without triggering another cart mutation.
        this._updateUI(this.isUnlocked);
      }

      // If locked state flipped, update the visual
      if (wasUnlocked !== this.isUnlocked) {
        this._updateUI(this.isUnlocked);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Cart mutation helpers
    // ─────────────────────────────────────────────────────────────

    async _addGiftToCart() {
      if (this._busy) return;
      this._busy = true;

      try {
        const cartDrawer = document.querySelector('cart-drawer');
        const formData   = new FormData();
        formData.append('id',       this.variantId);
        formData.append('quantity', 1);
        formData.append('properties[_gift]', 'true');

        if (cartDrawer) {
          formData.append(
            'sections',
            cartDrawer.getSectionsToRender().map((s) => s.id).join(',')
          );
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

        if (cartDrawer) cartDrawer.renderContents(cartData);

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source:    'cart-gift',
          cartData,
          variantId: this.variantId,
        });
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
        const cartDrawer = document.querySelector('cart-drawer');

        const body = JSON.stringify({
          id:       this.variantId,
          quantity: 0,
        });

        // Append sections for re-render if available
        let url = routes.cart_change_url;
        const sectionsParam = cartDrawer
          ? cartDrawer.getSectionsToRender().map((s) => s.id).join(',')
          : null;

        const resp = await fetch(url, {
          method:      'POST',
          credentials: 'same-origin',
          headers:     {
            'Content-Type':    'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: sectionsParam
            ? JSON.stringify({ id: this.variantId, quantity: 0, sections: sectionsParam, sections_url: window.location.pathname })
            : body,
        });

        if (!resp.ok) return;

        const cartData = await resp.json();
        this._updateUI(false);

        if (cartDrawer) cartDrawer.renderContents(cartData);

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source:    'cart-gift',
          cartData,
          variantId: this.variantId,
        });
      } catch (_) {
        // Gift remove is non-critical — fail silently
      } finally {
        this._busy = false;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // UI state
    // ─────────────────────────────────────────────────────────────

    _updateUI(unlocked) {
      this.dataset.selected = String(unlocked);
      // CSS in the theme drives locked/unlocked visuals via [data-selected]
    }

    // ─────────────────────────────────────────────────────────────
    // Variant picker support
    // ─────────────────────────────────────────────────────────────

    _updateVariantFromPicker(picker) {
      const variantJson = picker.querySelector('script[type="application/json"]');
      if (!variantJson) return;

      try {
        const variants = JSON.parse(variantJson.textContent);
        const selects  = [...picker.querySelectorAll('select.variant-dropdown')];
        const chosen   = selects.map((s) => s.value);

        const match = variants.find((v) =>
          v.options.every((opt, i) => opt === chosen[i])
        );

        if (match) this.variantId = match.id;
      } catch (_) {
        // Ignore JSON parse errors
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    _giftIsInCart(cartData) {
      const items = cartData.items || [];
      return items.some(
        (item) =>
          item.variant_id === this.variantId &&
          item.properties &&
          item.properties['_gift'] === 'true'
      );
    }
  }

  customElements.define('cart-drawer-gift', CartDrawerGift);
}
