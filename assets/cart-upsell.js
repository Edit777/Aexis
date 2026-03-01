if (!customElements.get('cart-drawer-upsell')) {
  class CartDrawerUpsell extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
      this.onChange = this.onChange.bind(this);
      this.selected = this.dataset.selected === 'true';
      this.busy = false;
    }

    connectedCallback() {
      this.drawer = document.querySelector('cart-drawer');
      this.togglable = this.dataset.toggle === 'true';
      this.form = this.querySelector('form');
      this.idInput = this.form?.querySelector('input[name="id"]');
      this.variants = this.readVariants();
      this.currentVariantId = Number(this.dataset.id || this.idInput?.value || 0);
      this.addEventListener('click', this.onClick);
      this.addEventListener('change', this.onChange);
      this.syncVisualState();
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('change', this.onChange);
    }

    readVariants() {
      const json = this.querySelector('.upsell__variant-picker script[type="application/json"]');
      if (!json) return [];
      return JSON.parse(json.textContent || '[]');
    }

    onClick(event) {
      if (!this.togglable || this.busy) return;
      const toggle = event.target.closest('.upsell-toggle-btn');
      if (!toggle) return;

      if (toggle.tagName === 'A' || toggle.closest('.upsell__variant-picker')) return;
      event.preventDefault();
      this.toggleSelection();
    }

    async onChange(event) {
      const select = event.target.closest('.variant-dropdown');
      if (!select) return;

      const previousVariantId = this.currentVariantId;
      this.resolveVariantFromSelectors();
      this.syncVariantInput();

      if (this.selected && previousVariantId && previousVariantId !== this.currentVariantId) {
        await this.removeFromCart(previousVariantId, false);
        await this.addToCart(false);
      }
    }

    resolveVariantFromSelectors() {
      const selects = Array.from(this.querySelectorAll('.variant-dropdown'));
      if (!selects.length || !this.variants.length) return;

      const values = selects.map((s) => s.value);
      const matched = this.variants.find((variant) =>
        variant.options.every((value, index) => value === values[index])
      );

      if (matched) {
        this.currentVariantId = Number(matched.id);
        this.dataset.id = String(matched.id);
      }
    }

    syncVariantInput() {
      if (this.idInput && this.currentVariantId) {
        this.idInput.value = String(this.currentVariantId);
      }
    }

    syncVisualState() {
      this.classList.toggle('selected', this.selected);
      this.dataset.selected = this.selected ? 'true' : 'false';
    }

    async toggleSelection() {
      if (this.selected) {
        const ok = await this.removeFromCart(this.currentVariantId, true);
        if (ok) this.selected = false;
      } else {
        const ok = await this.addToCart(true);
        if (ok) this.selected = true;
      }
      this.syncVisualState();
    }

    async addToCart(rerender) {
      if (!this.currentVariantId) return false;
      this.busy = true;
      try {
        const formData = new FormData();
        formData.append('id', this.currentVariantId);
        formData.append('quantity', 1);

        if (this.drawer) {
          formData.append('sections', this.drawer.getSectionsToRender().map((s) => s.id).join(','));
          formData.append('sections_url', window.location.pathname);
        }

        const response = await fetch(routes.cart_add_url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: formData,
        });

        if (!response.ok) return false;
        const cartData = await response.json();
        if (rerender && this.drawer) this.drawer.renderContents(cartData);
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-upsell', cartData, variantId: this.currentVariantId });
        }
        return true;
      } catch (error) {
        return false;
      } finally {
        this.busy = false;
      }
    }

    async removeFromCart(variantId, rerender) {
      if (!variantId) return false;
      this.busy = true;
      try {
        const payload = { id: Number(variantId), quantity: 0 };

        if (this.drawer) {
          payload.sections = this.drawer.getSectionsToRender().map((s) => s.id).join(',');
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

        if (!response.ok) return false;
        const cartData = await response.json();
        if (rerender && this.drawer) this.drawer.renderContents(cartData);
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-upsell', cartData, variantId: Number(variantId) });
        }
        return true;
      } catch (error) {
        return false;
      } finally {
        this.busy = false;
      }
    }
  }

  customElements.define('cart-drawer-upsell', CartDrawerUpsell);
}
