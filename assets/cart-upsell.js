if (!customElements.get('cart-drawer-upsells')) {
  class CartDrawerUpsells extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
      this.onVariantChange = this.onVariantChange.bind(this);
      this.onCartUpdate = this.onCartUpdate.bind(this);
      this.busy = false;
    }

    connectedCallback() {
      this.drawer = document.querySelector('cart-drawer');
      this.controlStyle = this.dataset.controlStyle;
      this.toggleElement = this.dataset.toggleElement;
      this.hideInCartItems = this.dataset.hideInCart === 'true';
      this.enablePriceUpdates = this.dataset.enablePriceUpdates === 'true';
      this.skipUnavailable = this.dataset.skipUnavailable === 'true';
      this.hideComparePrice = this.dataset.hideComparePrice === 'true';
      this.moneyFormat = this.dataset.moneyFormat || '${{amount}}';

      this.items = Array.from(this.querySelectorAll('[data-upsell-item]'));
      this.setupItems();
      this.applyPreselectedState();
      this.addEventListener('click', this.onClick);
      this.addEventListener('change', this.onVariantChange);
      subscribe(PUB_SUB_EVENTS.cartUpdate, this.onCartUpdate);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('change', this.onVariantChange);
    }

    setupItems() {
      this.items.forEach((item) => {
        const variantsNode = item.querySelector('[data-upsell-variants]');
        try {
          item._variants = JSON.parse(variantsNode?.textContent || '[]');
        } catch (_) {
          item._variants = [];
        }

        item._selectedVariant = item._variants.find(
          (variant) => String(variant.id) === item.dataset.initialVariantId
        ) || item._variants[0] || null;

        if (this.skipUnavailable) {
          this.ensureAvailableVariant(item);
        }

        this.syncVariantInputs(item);
        this.syncItemVisualState(item);
        this.updateDisplayedPrice(item);
      });
    }

    applyPreselectedState() {
      if (this.controlStyle !== 'toggle_switch') return;

      this.items.forEach((item) => {
        const inCart = item.dataset.inCart === 'true';
        const preselected = item.dataset.preselected === 'true';
        const selected = inCart || preselected;
        item.dataset.selected = selected ? 'true' : 'false';
        this.syncItemVisualState(item);

        if (!inCart && preselected) {
          this.addVariant(item, false);
        }
      });
    }

    onCartUpdate(event) {
      const cartData = event?.cartData;
      if (!cartData?.items) return;

      const variantIdsInCart = new Set(cartData.items.map((line) => String(line.variant_id)));
      this.items.forEach((item) => {
        const selectedVariantId = String(item._selectedVariant?.id || item.dataset.initialVariantId);
        const isInCart = variantIdsInCart.has(selectedVariantId);
        item.dataset.inCart = isInCart ? 'true' : 'false';

        if (this.controlStyle === 'toggle_switch') {
          const preselected = item.dataset.preselected === 'true';
          item.dataset.selected = isInCart || preselected ? 'true' : 'false';
        } else {
          item.dataset.selected = isInCart ? 'true' : 'false';
          if (this.hideInCartItems && isInCart) item.hidden = true;
        }

        this.syncItemVisualState(item);
      });
    }

    onClick(event) {
      const control = event.target.closest('[data-upsell-control]');
      if (!control) {
        if (this.toggleElement !== 'container' || this.controlStyle !== 'toggle_switch') return;
        const item = event.target.closest('[data-upsell-item]');
        if (!item) return;
        const isInteractive = event.target.closest('button, select, a, input, label');
        if (isInteractive) return;
        this.toggleItem(item);
        return;
      }

      const item = control.closest('[data-upsell-item]');
      if (!item || this.busy) return;

      if (this.controlStyle === 'toggle_switch') {
        this.toggleItem(item);
      } else {
        this.addVariant(item, true);
      }
    }

    async onVariantChange(event) {
      const select = event.target.closest('[data-option-position]');
      if (!select) return;
      const item = select.closest('[data-upsell-item]');
      if (!item) return;

      const previousVariantId = String(item.dataset.initialVariantId);
      this.resolveVariant(item);
      if (this.skipUnavailable) {
        this.ensureAvailableVariant(item);
      }
      this.syncVariantInputs(item);
      if (this.enablePriceUpdates) {
        this.updateDisplayedPrice(item);
      }

      if (this.controlStyle === 'toggle_switch' && item.dataset.inCart === 'true') {
        await this.removeVariantById(previousVariantId, false);
        await this.addVariant(item, false);
      }
    }

    resolveVariant(item) {
      const selects = Array.from(item.querySelectorAll('[data-option-position]'));
      const selectedOptions = selects.map((select) => select.value);

      const matched = item._variants.find((variant) =>
        variant.options.every((value, index) => value === selectedOptions[index])
      );

      if (matched) {
        item._selectedVariant = matched;
      }
    }

    ensureAvailableVariant(item) {
      if (!item._selectedVariant?.available) {
        const firstAvailable = item._variants.find((variant) => variant.available);
        if (firstAvailable) item._selectedVariant = firstAvailable;
      }
    }

    syncVariantInputs(item) {
      if (!item._selectedVariant) return;
      const selects = Array.from(item.querySelectorAll('[data-option-position]'));

      selects.forEach((select, index) => {
        const selectedOption = item._selectedVariant.options[index];
        Array.from(select.options).forEach((optionNode) => {
          const candidate = item._variants.find((variant) => {
            if (variant.options[index] !== optionNode.value) return false;
            return selects.every((otherSelect, otherIndex) => {
              if (otherIndex === index) return true;
              const expected = otherIndex < index ? otherSelect.value : item._selectedVariant.options[otherIndex];
              return variant.options[otherIndex] === expected;
            });
          });

          if (this.skipUnavailable) {
            optionNode.hidden = !candidate || !candidate.available;
          }

          optionNode.disabled = !candidate || (this.skipUnavailable ? !candidate.available : false);
        });

        select.value = selectedOption;
      });

      item.dataset.initialVariantId = String(item._selectedVariant.id);
      item.dataset.unavailable = item._selectedVariant.available ? 'false' : 'true';
      this.syncItemVisualState(item);
    }

    updateDisplayedPrice(item) {
      if (!item._selectedVariant) return;

      const percent = Number(item.dataset.discountPercent || 0);
      const fixedCents = Number(item.dataset.discountFixedCents || 0);
      const compareBase = Number(item._selectedVariant.compare_at_price || item._selectedVariant.price || 0);
      const finalCents = Math.max(
        0,
        Math.round(Number(item._selectedVariant.price || 0) * ((100 - percent) / 100) - fixedCents)
      );

      const finalNode = item.querySelector('[data-upsell-price-final]');
      const compareNode = item.querySelector('[data-upsell-price-compare]');
      if (finalNode) finalNode.textContent = this.formatMoney(finalCents);
      if (compareNode) {
        compareNode.textContent = this.formatMoney(compareBase);
        compareNode.hidden = this.hideComparePrice || compareBase <= finalCents;
      }
    }

    syncItemVisualState(item) {
      const selected = item.dataset.selected === 'true';
      const unavailable = item.dataset.unavailable === 'true';
      item.classList.toggle('is-selected', selected);
      item.classList.toggle('is-unavailable', unavailable);

      const toggle = item.querySelector('.cart-drawer-upsells__toggle');
      if (toggle) toggle.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }

    async toggleItem(item) {
      if (this.busy || item.dataset.unavailable === 'true') return;

      const selected = item.dataset.selected === 'true';
      if (selected) {
        await this.removeVariantById(item.dataset.initialVariantId, true);
        item.dataset.selected = 'false';
        item.dataset.preselected = 'false';
      } else {
        const ok = await this.addVariant(item, true);
        if (ok) item.dataset.selected = 'true';
      }

      this.syncItemVisualState(item);
    }

    async addVariant(item, syncUi) {
      if (!item._selectedVariant || item.dataset.unavailable === 'true') return false;
      this.busy = true;
      try {
        const formData = new FormData();
        formData.append('id', item._selectedVariant.id);
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
        if (this.drawer) this.drawer.renderContents(cartData);

        if (syncUi) {
          item.dataset.inCart = 'true';
          item.dataset.selected = 'true';
          this.syncItemVisualState(item);
        }

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'cart-upsell-rebuild',
          cartData,
          variantId: item._selectedVariant.id,
        });

        return true;
      } catch (_) {
        return false;
      } finally {
        this.busy = false;
      }
    }

    async removeVariantById(variantId, rerender) {
      this.busy = true;
      try {
        const payload = {
          id: Number(variantId),
          quantity: 0,
        };

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

        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'cart-upsell-rebuild',
          cartData,
          variantId: Number(variantId),
        });

        return true;
      } catch (_) {
        return false;
      } finally {
        this.busy = false;
      }
    }

    formatMoney(cents) {
      const value = (Number(cents || 0) / 100).toFixed(2);
      return this.moneyFormat
        .replace(/\{\{\s*amount\s*\}\}/, value)
        .replace(/\{\{\s*amount_no_decimals\s*\}\}/, String(Math.round(Number(cents || 0) / 100)));
    }
  }

  customElements.define('cart-drawer-upsells', CartDrawerUpsells);
}
