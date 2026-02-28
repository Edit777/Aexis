if (!customElements.get('marketing-content-tabs')) {
  class MarketingContentTabs extends HTMLElement {
    connectedCallback() {
      this.buttons = Array.from(this.querySelectorAll('[role="tab"]'));
      this.panels = Array.from(this.querySelectorAll('[role="tabpanel"]'));

      this.buttons.forEach((button, index) => {
        button.addEventListener('click', () => this.activate(index));
        button.addEventListener('keydown', (event) => this.onKeydown(event, index));
      });
    }

    onKeydown(event, currentIndex) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      let next = currentIndex + direction;

      if (next < 0) next = this.buttons.length - 1;
      if (next >= this.buttons.length) next = 0;

      this.activate(next);
      this.buttons[next].focus();
    }

    activate(index) {
      this.buttons.forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active.toString());
        button.setAttribute('tabindex', active ? '0' : '-1');
      });

      this.panels.forEach((panel, panelIndex) => {
        panel.classList.toggle('is-active', panelIndex === index);
        panel.hidden = panelIndex !== index;
      });
    }
  }

  customElements.define('marketing-content-tabs', MarketingContentTabs);
}
