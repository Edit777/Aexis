if (!customElements.get('cart-countdown-timer')) {
  class CartCountdownTimer extends HTMLElement {
    connectedCallback() {
      this.duration = Number.parseInt(this.dataset.duration, 10);
      this.template = this.dataset.template || '';
      this.textEl = this.querySelector('.cart-countdown__text');

      if (!this.textEl || !Number.isFinite(this.duration) || this.duration <= 0) return;

      this.remaining = this.duration;
      this.render();
      this.timer = window.setInterval(() => {
        this.remaining = Math.max(this.remaining - 1, 0);
        this.render();
        if (this.remaining === 0) window.clearInterval(this.timer);
      }, 1000);
    }

    disconnectedCallback() {
      if (this.timer) window.clearInterval(this.timer);
    }

    render() {
      const minutes = Math.ceil(this.remaining / 60);
      this.textEl.innerHTML = this.template.replace('[timer]', String(minutes));
    }
  }

  customElements.define('cart-countdown-timer', CartCountdownTimer);
}
