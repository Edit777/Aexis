/**
 * cart-upsell.js
 *
 * Custom element <cart-upsell-block> that fetches Shopify product
 * recommendations and renders them as add-to-cart cards inside the
 * cart drawer. Stays up to date as the cart changes.
 *
 * Recommendations endpoint used:
 *   /recommendations/products.json?product_id=X&limit=N&intent=related
 *
 * Dependencies (already on the page via cart-drawer):
 *   - pubsub.js  (subscribe / publish / PUB_SUB_EVENTS)
 *   - constants.js
 */

if (!customElements.get('cart-upsell-block')) {
  class CartUpsellBlock extends HTMLElement {
    connectedCallback() {
      this.productId   = this.dataset.productId;
      this.limit       = parseInt(this.dataset.limit   || '3',     10);
      this.layout      = this.dataset.layout            || 'scroll';
      this.showImage   = this.dataset.showImage        !== 'false';
      this.showPrice   = this.dataset.showPrice        !== 'false';
      this.moneyFormat = this.dataset.moneyFormat;
      this.buttonLabel = this.dataset.buttonLabel      || 'Add to cart';

      this.grid = this.querySelector('.cart-upsell__products');

      if (this.productId) this.fetchRecommendations(this.productId);

      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, ({ cartData } = {}) => {
        if (!cartData) return;

        if (!cartData.item_count) {
          this.hidden = true;
          return;
        }

        this.hidden = false;

        const firstId = String(cartData.items?.[0]?.product_id || '');
        if (firstId && firstId !== this.productId) {
          this.productId = firstId;
          this.fetchRecommendations(this.productId);
        }
      });
    }

    disconnectedCallback() {
      if (this.unsubscribe) this.unsubscribe();
    }

    async fetchRecommendations(productId) {
      if (!productId) return;
      try {
        const url  = `/recommendations/products.json?product_id=${productId}&limit=${this.limit}&intent=related`;
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) return;
        const { products } = await resp.json();
        this.renderProducts(products);
      } catch (_) {
        // Upsell is non-critical — swallow errors silently
      }
    }

    renderProducts(products) {
      const available = (products || [])
        .filter((p) => p.available)
        .slice(0, this.limit);

      if (!available.length) {
        this.hidden = true;
        return;
      }

      this.hidden = false;
      this.grid.innerHTML = available.map((p) => this.buildCard(p)).join('');

      this.grid.querySelectorAll('.cart-upsell__add-btn').forEach((btn) => {
        btn.addEventListener('click', this.handleAddToCart.bind(this));
      });
    }

    buildCard(product) {
      const variant = product.variants?.[0];
      if (!variant) return '';

      const price = this.formatMoney(variant.price, this.moneyFormat);

      const imageHtml = this.showImage && product.featured_image
        ? `<div class="cart-upsell__item-image">
             <img
               src="${this.escape(product.featured_image.url || product.featured_image.src || '')}?width=200"
               alt="${this.escape(product.featured_image.alt || product.title)}"
               loading="lazy"
               width="100"
               height="100"
             >
           </div>`
        : '';

      const priceHtml = this.showPrice
        ? `<p class="cart-upsell__item-price">${price}</p>`
        : '';

      return `<div class="cart-upsell__item">
        ${imageHtml}
        <div class="cart-upsell__item-content">
          <p class="cart-upsell__item-title">${this.escape(product.title)}</p>
          ${priceHtml}
          <button
            class="button button--full-width cart-upsell__add-btn"
            data-variant-id="${variant.id}"
            aria-label="Add ${this.escape(product.title)} to cart"
          >
            ${this.escape(this.buttonLabel)}
          </button>
        </div>
      </div>`;
    }

    async handleAddToCart(event) {
      const btn       = event.currentTarget;
      const variantId = parseInt(btn.dataset.variantId, 10);

      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');

      try {
        const cartDrawer = document.querySelector('cart-drawer');
        const formData = new FormData();
        formData.append('id', variantId);
        formData.append('quantity', 1);

        if (cartDrawer) {
          formData.append(
            'sections',
            cartDrawer.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
        }

        const addResp = await fetch(`${routes.cart_add_url}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: formData,
        });

        if (!addResp.ok) throw new Error('add failed');

        const cartData = await addResp.json();

        if (cartDrawer) {
          cartDrawer.renderContents(cartData);
        }

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'cart-items',
          cartData,
          variantId,
        });

        const originalLabel = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => {
          btn.textContent = originalLabel;
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
        }, 1500);
      } catch (_) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }

    formatMoney(cents, format) {
      const amount = (cents || 0) / 100;
      return format
        .replace('{{amount}}',                                    amount.toFixed(2))
        .replace('{{amount_no_decimals}}',                        Math.round(amount))
        .replace('{{amount_with_comma_separator}}',               amount.toFixed(2).replace('.', ','))
        .replace('{{amount_no_decimals_with_comma_separator}}',   Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','))
        .replace('{{amount_with_apostrophe_separator}}',          amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"))
        .replace('{{amount_no_decimals_no_space_separator}}',     Math.round(amount).toString().replace(/\s/g, ''));
    }

    escape(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  customElements.define('cart-upsell-block', CartUpsellBlock);
}
