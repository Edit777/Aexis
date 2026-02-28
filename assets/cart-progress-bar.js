/**
 * cart-progress-bar.js
 *
 * Custom element <cart-progress-bar> that renders a goal progress bar
 * and reacts to Dawn's cart-update pubsub event without a page reload.
 *
 * Dependencies (already on the page via cart-drawer):
 *   - pubsub.js  (subscribe / PUB_SUB_EVENTS)
 *   - constants.js (PUB_SUB_EVENTS.cartUpdate === 'cart-update')
 */

if (!customElements.get('cart-progress-bar')) {
  class CartProgressBar extends HTMLElement {
    connectedCallback() {
      this.goalType        = this.dataset.goalType;           // 'amount' | 'quantity'
      this.goal = Number.parseFloat(this.dataset.goal); // cents (amount) or integer (quantity)
      this.progressMessage = this.dataset.progressMessage;    // text with {amount} placeholder
      this.successMessage  = this.dataset.successMessage;
      this.moneyFormat     = this.dataset.moneyFormat;

      this.fillEl    = this.querySelector('.cart-progress-bar__fill');
      this.messageEl = this.querySelector('.cart-progress-bar__message');

      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, ({ cartData } = {}) => {
        if (cartData) this.update(cartData);
      });
    }

    disconnectedCallback() {
      if (this.unsubscribe) this.unsubscribe();
    }

    update(cartData) {
      const current  = this.goalType === 'quantity'
        ? cartData.item_count
        : cartData.items_subtotal_price;

      const safeGoal = Number.isFinite(this.goal) && this.goal > 0 ? this.goal : 0;
      const rawPct = safeGoal > 0 ? (current / safeGoal) * 100 : 0;
      const progress = Math.round(Math.min(Math.max(rawPct, 0), 100) * 10) / 10; // 1 decimal place
      const reached  = safeGoal > 0 && progress >= 100;

      this.fillEl.style.width = `${progress}%`;
      this.fillEl.classList.add('is-animated');
      this.fillEl.setAttribute('aria-valuenow', Math.round(progress));

      if (reached) {
        this.messageEl.textContent = this.successMessage;
      } else {
        const remaining = Math.max((safeGoal || 0) - current, 0);
        const display   = this.goalType === 'quantity'
          ? String(remaining)
          : this.formatMoney(remaining, this.moneyFormat);
        this.messageEl.textContent = this.progressMessage.replace('[amount]', display);
      }
    }

    /**
     * Formats a cents value using Shopify's money format string.
     * Handles the most common format placeholders.
     */
    formatMoney(cents, format) {
      const amount = cents / 100;
      return format
        .replace('{{amount}}',                                    amount.toFixed(2))
        .replace('{{amount_no_decimals}}',                        Math.round(amount))
        .replace('{{amount_with_comma_separator}}',               amount.toFixed(2).replace('.', ','))
        .replace('{{amount_no_decimals_with_comma_separator}}',   Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','))
        .replace('{{amount_with_apostrophe_separator}}',          amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"))
        .replace('{{amount_no_decimals_no_space_separator}}',     Math.round(amount).toString().replace(/\s/g, ''));
    }
  }

  customElements.define('cart-progress-bar', CartProgressBar);
}
