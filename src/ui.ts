// Bottom toolbar: Grade / Light / Water / Shot menus, FOV + grain sliders, H to hide, ? for help.

export interface MenuDef {
  id: string;
  label: string;
  options: string[];
  value: number;
  onPick(i: number): void;
  extra?: (pop: HTMLElement) => void; // extra controls under the list
}

export interface SliderDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput(v: number): void;
}

export class Toolbar {
  root: HTMLElement;
  bar: HTMLElement;
  pop: HTMLElement;
  help: HTMLElement;
  private menus = new Map<string, { def: MenuDef; valueEl: HTMLElement; btn: HTMLElement }>();
  private openId: string | null = null;
  hidden = false;

  constructor(menus: MenuDef[], sliders: SliderDef[]) {
    this.root = document.createElement('div');
    this.root.className = 'ui';
    this.bar = document.createElement('div');
    this.bar.className = 'bar';
    this.pop = document.createElement('div');
    this.pop.className = 'pop';
    this.help = document.createElement('div');
    this.help.className = 'help';
    this.help.innerHTML = `
      <div class="help-title">Burj Khalifa</div>
      <div class="help-sub">The tower and Downtown Dubai, rendered live in your browser with three.js from OpenStreetMap data.</div>
      <dl>
        <dt>Click the lake</dt><dd>Start or stop the fountain show</dd>
        <dt>Click the tower</dt><dd>Start or stop the light show</dd>
        <dt>E</dt><dd>Ride the elevator to level 148</dd>
        <dt>Drag / scroll</dt><dd>Orbit and zoom</dd>
        <dt>1 to 5</dt><dd>Camera shots, 0 stops</dd>
        <dt>T</dt><dd>Next time of day</dd>
        <dt>H</dt><dd>Hide or show this bar</dd>
      </dl>
      <div class="help-foot">Buildings, roads and water from OpenStreetMap contributors (ODbL). The tower's 27 setbacks follow its mapped 3D parts. Music is original and generated in your browser.</div>`;

    for (const m of menus) {
      const btn = document.createElement('button');
      btn.className = 'item';
      btn.innerHTML = `<span class="k">${m.label}</span><span class="v"></span>`;
      const valueEl = btn.querySelector('.v') as HTMLElement;
      valueEl.textContent = m.options[m.value];
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(m.id);
      });
      this.bar.appendChild(btn);
      this.menus.set(m.id, { def: m, valueEl, btn });
    }
    for (const s of sliders) {
      const wrap = document.createElement('label');
      wrap.className = 'item slider';
      wrap.innerHTML = `<span class="k">${s.label}</span>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.value = String(s.value);
      input.addEventListener('input', () => s.onInput(parseFloat(input.value)));
      wrap.appendChild(input);
      this.bar.appendChild(wrap);
    }
    const keys = document.createElement('div');
    keys.className = 'item keys';
    const hBtn = document.createElement('button');
    hBtn.className = 'kbd';
    hBtn.textContent = 'H';
    hBtn.title = 'Hide the bar (H)';
    hBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHidden(); });
    const qBtn = document.createElement('button');
    qBtn.className = 'kbd';
    qBtn.textContent = '?';
    qBtn.title = 'Controls';
    qBtn.addEventListener('click', (e) => { e.stopPropagation(); this.help.classList.toggle('show'); this.closeMenu(); });
    keys.append(hBtn, qBtn);
    this.bar.appendChild(keys);

    this.root.append(this.pop, this.bar, this.help);
    document.body.appendChild(this.root);
    document.addEventListener('click', () => { this.closeMenu(); this.help.classList.remove('show'); });
    this.pop.addEventListener('click', (e) => e.stopPropagation());
    this.help.addEventListener('click', (e) => e.stopPropagation());
  }

  setValue(id: string, i: number) {
    const m = this.menus.get(id);
    if (!m) return;
    m.def.value = i;
    m.valueEl.textContent = i >= 0 ? m.def.options[i] : 'Custom';
    if (this.openId === id) this.renderMenu(id);
  }

  setValueText(id: string, text: string) {
    const m = this.menus.get(id);
    if (m) m.valueEl.textContent = text;
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.root.classList.toggle('hidden', this.hidden);
    this.closeMenu();
  }

  private toggleMenu(id: string) {
    if (this.openId === id) return this.closeMenu();
    this.openId = id;
    this.help.classList.remove('show');
    this.renderMenu(id);
  }

  private renderMenu(id: string) {
    const m = this.menus.get(id)!;
    this.pop.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'pop-title';
    title.textContent = m.def.label;
    this.pop.appendChild(title);
    m.def.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'opt' + (i === m.def.value ? ' on' : '');
      b.textContent = o;
      b.addEventListener('click', () => {
        m.def.onPick(i);
        this.setValue(id, i);
      });
      this.pop.appendChild(b);
    });
    if (m.def.extra) m.def.extra(this.pop);
    // place the popover above its button
    const br = m.btn.getBoundingClientRect();
    this.pop.classList.add('show');
    const pw = this.pop.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, br.left + br.width / 2 - pw / 2));
    this.pop.style.left = `${left}px`;
    this.pop.style.bottom = `${window.innerHeight - br.top + 10}px`;
    m.btn.classList.add('open');
  }

  closeMenu() {
    if (this.openId) this.menus.get(this.openId)?.btn.classList.remove('open');
    this.openId = null;
    this.pop.classList.remove('show');
  }
}
