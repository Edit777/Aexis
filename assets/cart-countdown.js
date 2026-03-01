if (!customElements.get('cart-countdown-timer')) {
  class CartCountdownTimer extends HTMLElement {
    connectedCallback() {
      this.duration = Number.parseInt(this.dataset.duration, 10);
      this.template = this.dataset.template || '';
      this.textEl = this.querySelector('.cart-countdown__text');

      if (!this.textEl || !Number.isFinite(this.duration) || this.duration <= 0) return;

      this.start();

      document.addEventListener('cart-drawer:open', () => this.reset());
    }

    disconnectedCallback() {
      this.stop();
    }

    start() {
      this.remaining = this.duration;
      this.render();
      this.timer = window.setInterval(() => {
        this.remaining = Math.max(this.remaining - 1, 0);
        this.render();
        if (this.remaining === 0) this.stop();
      }, 1000);
    }

    stop() {
      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    }

    reset() {
      this.stop();
      this.start();
    }

    render() {
      const minutes = Math.floor(this.remaining / 60);
      const seconds = this.remaining % 60;
      const mm = String(minutes).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      this.textEl.innerHTML = this.template.replace('[timer]', `${mm}:${ss}`);
    }
  }

  customElements.define('cart-countdown-timer', CartCountdownTimer);
}
