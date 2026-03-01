/**
 * cart-upsell.js
 *
 * Supports two upsell implementations:
 *  1) <cart-upsell-block> (new card-based recommendations)
 *  2) <cart-drawer-upsell> (legacy markup rendered by snippets/upsell-block.liquid)
 */

if (!customElements.get('cart-upsell-block')) {
  class CartUpsellBlock extends HTMLElement {
    connectedCallback() {
      this.productId = this.dataset.productId;
      this.limit = parseInt(this.dataset.limit || '3', 10);
      this.layout = this.dataset.layout || 'scroll';
      this.showImage = this.dataset.showImage !== 'false';
      this.showPrice = this.dataset.showPrice !== 'false';
      this.moneyFormat = this.dataset.moneyFormat;
      this.buttonLabel = this.dataset.buttonLabel || 'Add to cart';

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
        const url = `/recommendations/products.json?product_id=${productId}&limit=${this.limit}&intent=related`;
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

      const imageHtml =
        this.showImage && product.featured_image
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

      const priceHtml = this.showPrice ? `<p class="cart-upsell__item-price">${price}</p>` : '';

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
      const btn = event.currentTarget;
      const variantId = parseInt(btn.dataset.variantId, 10);

      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');

      try {
        const cartDrawer = document.querySelector('cart-drawer');
        const formData = new FormData();
        formData.append('id', variantId);
        formData.append('quantity', 1);

        if (cartDrawer) {
          formData.append('sections', cartDrawer.getSectionsToRender().map((section) => section.id));
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
        .replace('{{amount}}', amount.toFixed(2))
        .replace('{{amount_no_decimals}}', Math.round(amount))
        .replace('{{amount_with_comma_separator}}', amount.toFixed(2).replace('.', ','))
        .replace(
          '{{amount_no_decimals_with_comma_separator}}',
          Math.round(amount)
            .toString()
            .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        )
        .replace('{{amount_with_apostrophe_separator}}', amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"))
        .replace('{{amount_no_decimals_no_space_separator}}', Math.round(amount).toString().replace(/\s/g, ''));
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

if (!customElements.get('cart-drawer-upsell')) {
  class CartDrawerUpsell extends HTMLElement {
    connectedCallback() {
      this.cartDrawer = document.querySelector('cart-drawer');
      this.cartItems = this.cartDrawer?.querySelector('cart-drawer-items') || null;

      this.toggleEnabled = this.dataset.toggle === 'true';
      this.skipNonExistent = this.dataset.skipNonExistent === 'true';
      this.skipUnavailable = this.dataset.skipUnavailable === 'true';

      this.addButton = this.querySelector('.upsell__add-btn');
      this.defaultLabel = this.dataset.defaultLabel || 'Add';
      this.selectedLabel = this.dataset.selectedLabel || 'Added';
      this.unavailableLabel = this.dataset.unavailableLabel || 'Sold out';
      this.form = this.querySelector('product-form form');
      this.idInput = this.form?.querySelector('[name="id"]');
      this.variantPicker = this.querySelector('.upsell__variant-picker');
      this.variantDataNode = this.variantPicker?.querySelector('script[type="application/json"]') || null;
      this.variantSelectElements = [...(this.variantPicker?.querySelectorAll('select.variant-dropdown') || [])];

      this.variantData = this.getVariantData();
      this.selectedVariantId = parseInt(this.dataset.id || this.idInput?.value, 10) || null;
      if (this.selectedVariantId) this.syncVariantInputs(this.selectedVariantId);

      this.boundToggleClick = this.onToggleClick.bind(this);
      this.querySelectorAll('.upsell-toggle-btn').forEach((node) => {
        node.addEventListener('click', this.boundToggleClick);
      });

      if (this.variantPicker) {
        this.boundVariantChange = this.onVariantChange.bind(this);
        this.variantPicker.addEventListener('change', this.boundVariantChange);
      }

      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, ({ cartData } = {}) => {
        if (!cartData) return;
        this.syncSelectedWithCart(cartData);
      });

      this.updateOptionStatuses();
      this.updateAvailabilityUI();
      this.syncSelectionState();
    }

    disconnectedCallback() {
      if (this.unsubscribe) this.unsubscribe();
      this.querySelectorAll('.upsell-toggle-btn').forEach((node) => {
        node.removeEventListener('click', this.boundToggleClick);
      });
      if (this.variantPicker) {
        this.variantPicker.removeEventListener('change', this.boundVariantChange);
      }
    }

    getVariantData() {
      if (!this.variantDataNode) return [];
      try {
        return JSON.parse(this.variantDataNode.textContent || '[]');
      } catch (_) {
        return [];
      }
    }

    onToggleClick(event) {
      const tagName = event.target.tagName.toLowerCase();
      if (tagName === 'select' || tagName === 'option') return;

      if (!this.toggleEnabled || this._busy) return;
      event.preventDefault();

      const selected = this.dataset.selected === 'true';
      if (selected) {
        this.removeFromCart();
      } else {
        this.addToCart();
      }
    }

    onVariantChange() {
      if (!this.variantSelectElements.length) return;

      this.updateOptionStatuses();

      const selectedOptions = this.variantSelectElements.map((select) => select.value);
      let variant = this.findVariantByOptions(selectedOptions);

      if (!variant && this.skipNonExistent) {
        const fallback = this.findFirstMatchingVariant(selectedOptions, false);
        if (fallback) {
          this.setSelectsFromVariant(fallback);
          variant = fallback;
        }
      }

      if (variant && !variant.available && this.skipUnavailable) {
        const availableFallback = this.findFirstMatchingVariant(selectedOptions, true);
        if (availableFallback) {
          this.setSelectsFromVariant(availableFallback);
          variant = availableFallback;
        }
      }

      if (!variant) {
        this.selectedVariantId = null;
        this.dataset.id = '';
        this.updateAvailabilityUI(false);
        return;
      }

      this.syncVariantInputs(variant.id);
      this.updateAvailabilityUI(variant.available);
    }

    setSelectsFromVariant(variant) {
      if (!variant?.options) return;
      this.variantSelectElements.forEach((select, index) => {
        if (variant.options[index] !== undefined) {
          select.value = variant.options[index];
        }
      });
      this.updateOptionStatuses();
    }

    syncVariantInputs(variantId) {
      this.selectedVariantId = parseInt(variantId, 10);
      this.dataset.id = String(this.selectedVariantId);
      if (this.idInput) this.idInput.value = String(this.selectedVariantId);
    }

    findVariantByOptions(options) {
      return this.variantData.find((variant) => variant.options.every((opt, index) => opt === options[index]));
    }

    findFirstMatchingVariant(options, onlyAvailable) {
      return this.variantData.find((variant) => {
        if (onlyAvailable && !variant.available) return false;
        return variant.options.every((opt, index) => {
          if (options[index] === undefined || options[index] === null) return true;
          return options[index] === opt;
        });
      });
    }

    updateOptionStatuses() {
      if (!this.variantSelectElements.length || !this.variantData.length) return;

      const selectedOptions = this.variantSelectElements.map((select) => select.value);

      this.variantSelectElements.forEach((select, selectIndex) => {
        const options = [...select.options];

        options.forEach((optionElement) => {
          const testSelection = [...selectedOptions];
          testSelection[selectIndex] = optionElement.value;

          const matches = this.variantData.filter((variant) => {
            return variant.options.every((opt, index) => {
              if (index === selectIndex) return opt === optionElement.value;
              const chosen = selectedOptions[index];
              return !chosen || opt === chosen;
            });
          });

          const exists = matches.length > 0;
          const available = matches.some((variant) => variant.available);

          optionElement.classList.remove('non-existent', 'unavailable');
          optionElement.disabled = false;

          if (!exists) {
            optionElement.classList.add('non-existent');
            if (this.skipNonExistent) optionElement.disabled = true;
          } else if (!available) {
            optionElement.classList.add('unavailable');
            if (this.skipUnavailable) optionElement.disabled = true;
          }
        });

        if (select.selectedOptions[0]?.disabled) {
          const firstEnabled = options.find((option) => !option.disabled);
          if (firstEnabled) {
            select.value = firstEnabled.value;
            selectedOptions[selectIndex] = firstEnabled.value;
          }
        }
      });
    }

    updateAvailabilityUI(isAvailable = true) {
      this.dataset.unavailable = String(!isAvailable);
      this.classList.toggle('is-unavailable', !isAvailable);
      this.classList.toggle('is-actionable', isAvailable);

      if (!this.addButton) return;
      this.addButton.toggleAttribute('disabled', !isAvailable);

      if (!isAvailable) {
        this.updateButtonLabel(this.unavailableLabel);
      } else if (this.dataset.selected === 'true') {
        this.updateButtonLabel(this.selectedLabel);
      } else {
        this.updateButtonLabel(this.defaultLabel);
      }
    }

    updateButtonLabel(label) {
      if (!this.addButton) return;

      const labelNode = this.addButton.querySelector('span');
      if (labelNode) {
        labelNode.textContent = label;
      } else {
        this.addButton.textContent = label;
      }
    }

    setBusy(isBusy) {
      this._busy = isBusy;
      this.querySelectorAll('.upsell-toggle-btn').forEach((node) => {
        node.toggleAttribute('disabled', isBusy);
        node.setAttribute('aria-busy', String(isBusy));
      });
      this.variantSelectElements.forEach((select) => {
        select.toggleAttribute('disabled', isBusy);
      });
    }

    async addToCart() {
      if (!this.selectedVariantId || this._busy) return;

      this.setBusy(true);
      try {
        const formData = new FormData();
        formData.append('id', this.selectedVariantId);
        formData.append('quantity', 1);

        if (this.cartDrawer) {
          formData.append('sections', this.cartDrawer.getSectionsToRender().map((section) => section.id).join(','));
          formData.append('sections_url', window.location.pathname);
        }

        const response = await fetch(routes.cart_add_url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: formData,
        });

        if (!response.ok) return;

        const cartData = await response.json();
        this.dataset.selected = 'true';

        if (this.cartDrawer) this.cartDrawer.renderContents(cartData);

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'cart-upsell',
          cartData,
          variantId: this.selectedVariantId,
        });
      } catch (_) {
        // non-critical
      } finally {
        this.setBusy(false);
      }
    }

    async removeFromCart() {
      if (!this.selectedVariantId || this._busy) return;

      this.setBusy(true);
      try {
        const payload = {
          id: this.selectedVariantId,
          quantity: 0,
        };

        if (this.cartDrawer) {
          payload.sections = this.cartDrawer.getSectionsToRender().map((section) => section.id).join(',');
          payload.sections_url = window.location.pathname;
        }

        const response = await fetch(routes.cart_change_url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) return;

        const cartData = await response.json();
        this.dataset.selected = 'false';

        if (this.cartDrawer) this.cartDrawer.renderContents(cartData);

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'cart-upsell',
          cartData,
          variantId: this.selectedVariantId,
        });
      } catch (_) {
        // non-critical
      } finally {
        this.setBusy(false);
      }
    }

    syncSelectedWithCart(cartData) {
      const selectedVariant = parseInt(this.dataset.id, 10);
      if (!selectedVariant) return;

      const inCart = (cartData.items || []).some((item) => item.variant_id === selectedVariant);
      this.dataset.selected = String(inCart);
      this.syncSelectionState();
    }

    syncSelectionState() {
      const selected = this.dataset.selected === 'true';
      this.dataset.state = selected ? 'selected' : 'default';
      this.classList.toggle('is-selected', selected);
      this.setAttribute('aria-selected', String(selected));

      if (this.addButton && this.dataset.unavailable !== 'true') {
        this.updateButtonLabel(selected ? this.selectedLabel : this.defaultLabel);
      }
    }
  }

  customElements.define('cart-drawer-upsell', CartDrawerUpsell);
}
