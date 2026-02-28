/**
 * cart-discount.js
 *
 * Custom element <cart-discount-field> that applies/reflects a Shopify
 * discount code entirely via AJAX — no page reload.
 *
 * Flow:
 *  1. User submits code → GET /discount/{code} (sets session cookie)
 *  2. POST /cart/update.js with { sections: ['cart-drawer'] }
 *     → returns updated cart JSON + fresh section HTML in one round-trip
 *  3. If cart_level_discount_applications is non-empty the code applied:
 *     - show success message
 *     - patch the totals area in the DOM
 *     - publish cartUpdate so progress bars / subtotals refresh
 *  4. Otherwise show error message (invalid / not applicable to current items)
 *
 * Dependencies (already on the page via cart-drawer):
 *   - pubsub.js  (publish / PUB_SUB_EVENTS)
 *   - constants.js
 */

if (!customElements.get('cart-discount-field')) {
  class CartDiscountField extends HTMLElement {
    connectedCallback() {
      this.form      = this.querySelector('.cart-discount-field__form');
      this.input     = this.querySelector('.cart-discount-field__input');
      this.errorEl   = this.querySelector('.cart-discount-field__error');
      this.successEl = this.querySelector('.cart-discount-field__success');

      this.form.addEventListener('submit', this.handleSubmit.bind(this));
    }

    async handleSubmit(event) {
      event.preventDefault();
      const code = this.input.value.trim();
      if (!code) return;

      this.setLoading(true);
      this.clearMessages();

      try {
        // Step 1 – apply discount cookie to this session
        await fetch(`/discount/${encodeURIComponent(code)}`, {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'follow',
        });

        // Step 2 – trigger a no-op cart update to get fresh section HTML + cart state
        const response = await fetch('/cart/update.js', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sections: ['cart-drawer'],
            sections_url: window.location.pathname,
          }),
        });

        const cartState = await response.json();

        // Step 3 – check whether the discount actually reduced the cart
        const applied = Array.isArray(cartState.cart_level_discount_applications)
          && cartState.cart_level_discount_applications.length > 0;

        if (applied) {
          this.input.value = '';
          this.showSuccess(this.dataset.successMessage);

          // Patch only the totals area to avoid re-mounting the whole drawer
          if (cartState.sections?.['cart-drawer']) {
            this.patchDrawerFooter(cartState.sections['cart-drawer']);
          }

          publish(PUB_SUB_EVENTS.cartUpdate, {
            source: 'cart-discount-field',
            cartData: cartState,
          });
        } else {
          this.showError(this.dataset.errorMessage);
        }
      } catch (_) {
        this.showError(this.dataset.errorMessage);
      } finally {
        this.setLoading(false);
      }
    }

    /**
     * Replaces only the .cart-drawer__footer totals element so we don't
     * touch the discount input itself or the checkout button.
     */
    patchDrawerFooter(sectionHtml) {
      const parser     = new DOMParser();
      const doc        = parser.parseFromString(sectionHtml, 'text/html');
      const newFooter  = doc.querySelector('.cart-drawer__footer');
      const currFooter = document.querySelector('#CartDrawer .cart-drawer__footer');
      if (newFooter && currFooter) currFooter.replaceWith(newFooter);
    }

    setLoading(loading) {
      const btn = this.form.querySelector('[type="submit"]');
      btn.disabled = loading;
      btn.setAttribute('aria-busy', String(loading));
    }

    clearMessages() {
      this.errorEl.hidden   = true;
      this.errorEl.textContent  = '';
      this.successEl.hidden = true;
      this.successEl.textContent = '';
    }

    showError(message) {
      this.errorEl.textContent = message;
      this.errorEl.hidden = false;
    }

    showSuccess(message) {
      this.successEl.textContent = message;
      this.successEl.hidden = false;
    }
  }

  customElements.define('cart-discount-field', CartDiscountField);
}
