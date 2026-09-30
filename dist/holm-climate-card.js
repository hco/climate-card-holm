/* HOLM Climate Card — https://github.com/kaaribou/climate-card-holm (licence MIT)
 * Carte climate compacte et vivante, pensée pour tenir à 2 côte à côte sur
 * mobile (6 colonnes) tout en s'étalant joliment en pleine largeur.
 * - Ambiance dynamique selon l'usage : éteint (sobre, désaturé),
 *   chauffage (lueur chaude + braises qui montent), clim (lueur froide +
 *   flocons qui tombent). Animations actives seulement quand l'appareil
 *   chauffe/refroidit réellement (hvac_action), sinon lueur apaisée.
 * - Roue de consigne 270° (glisser), − / + logés dans l'ouverture de la roue
 * - Modes en pastilles icônes (jamais tronquées) : Éteint / Chauffage / Clim
 * - Ventilation, préréglage, oscillation : puces compactes → volet de choix
 * - Mises à jour optimistes (latence Daikin Cloud)
 */
(() => {
  const VERSION = "1.0.0";
  const MODE_META = {
    off: { icon: "mdi:power", rgb: "150,160,178", label: "Éteint" },
    heat: { icon: "mdi:fire", rgb: "255,128,48", label: "Chauffe" },
    cool: { icon: "mdi:snowflake", rgb: "64,190,255", label: "Clim" },
    heat_cool: { icon: "mdi:sun-snowflake-variant", rgb: "185,139,255", label: "Auto" },
    auto: { icon: "mdi:thermostat-auto", rgb: "185,139,255", label: "Auto" },
    dry: { icon: "mdi:water-percent", rgb: "45,217,196", label: "Déshum." },
    fan_only: { icon: "mdi:fan", rgb: "95,178,255", label: "Ventil." },
  };
  const PRIMARY_MODES = ["off", "heat", "cool"];

  // Dégradés de la roue [début, fin]
  const ARC_GRAD = {
    off: ["#6b7385", "#9aa3b5"],
    heat: ["#ffc46b", "#ff5a1f"],
    cool: ["#a8ecff", "#2f86ff"],
    heat_cool: ["#e3d2ff", "#9b6bff"],
    auto: ["#e3d2ff", "#9b6bff"],
    dry: ["#b9fff1", "#16b8a6"],
    fan_only: ["#cfe6ff", "#4a9dff"],
  };

  const ACTION_LABEL = {
    heating: "Chauffe",
    cooling: "Refroidit",
    drying: "Déshumidifie",
    fan: "Ventile",
    idle: "En veille",
    off: "Éteint",
    preheating: "Préchauffe",
    defrosting: "Dégivrage",
  };

  const FAN_META = {
    auto: { icon: "mdi:fan-auto", label: "Auto", speed: 1.4 },
    quiet: { icon: "mdi:weather-night", label: "Silence", speed: 3 },
    "1": { icon: "mdi:fan-speed-1", label: "1", speed: 2.4 },
    "2": { icon: "mdi:fan-speed-2", label: "2", speed: 1.8 },
    "3": { icon: "mdi:fan-speed-3", label: "3", speed: 1.3 },
    "4": { icon: "mdi:fan", label: "4", speed: 0.9 },
    "5": { icon: "mdi:fan", label: "5", speed: 0.6 },
    low: { icon: "mdi:fan-speed-1", label: "Faible", speed: 2.4 },
    medium: { icon: "mdi:fan-speed-2", label: "Moyen", speed: 1.5 },
    high: { icon: "mdi:fan-speed-3", label: "Fort", speed: 0.8 },
    off: { icon: "mdi:fan-off", label: "Arrêt", speed: 0 },
  };
  const PRESET_META = {
    none: { icon: "mdi:tune-variant", label: "Normal" },
    boost: { icon: "mdi:rocket-launch", label: "Boost" },
    away: { icon: "mdi:home-export-outline", label: "Absent" },
    eco: { icon: "mdi:leaf", label: "Éco" },
    comfort: { icon: "mdi:sofa", label: "Confort" },
    sleep: { icon: "mdi:sleep", label: "Nuit" },
    home: { icon: "mdi:home", label: "Maison" },
    activity: { icon: "mdi:run", label: "Activité" },
  };
  const SWING_META = {
    off: { icon: "mdi:arrow-oscillating-off", label: "Fixe" },
    stop: { icon: "mdi:arrow-oscillating-off", label: "Fixe" },
    on: { icon: "mdi:arrow-oscillating", label: "Oscille" },
    swing: { icon: "mdi:arrow-oscillating", label: "Oscille" },
    windnice: { icon: "mdi:weather-windy", label: "Confort" },
    vertical: { icon: "mdi:arrow-up-down", label: "Vertical" },
    horizontal: { icon: "mdi:arrow-left-right", label: "Horiz." },
    both: { icon: "mdi:arrow-all", label: "Les deux" },
  };
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, " ") : "");

  const START = 135;
  const SWEEP = 270;
  const C = 100;
  const R = 82;
  const OPTIMISTIC_TTL = 20000;
  const N_PARTICLES = 14;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const polar = (a, r = R) => {
    const rad = (a * Math.PI) / 180;
    return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
  };
  const arc = (a0, a1, r = R) => {
    if (a1 - a0 < 0.01) a1 = a0 + 0.01;
    const s = polar(a0, r), e = polar(a1, r);
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  };
  const fmt = (t, step) => {
    if (t == null || isNaN(t)) return "–";
    const d = step && step < 1 ? 1 : 0;
    return Number(t).toFixed(d).replace(".", ",");
  };

  class HolmClimateCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("holm-climate-card-editor");
    }
    static getStubConfig(hass) {
      const e = hass ? Object.keys(hass.states).find((k) => k.startsWith("climate.")) : "";
      return { type: "custom:holm-climate-card", entity: e || "", show_fan: true, show_preset: true, show_swing: false };
    }
    setConfig(config) {
      if (!config || !config.entity) throw new Error("Choisis une entité climate dans l'éditeur.");
      this._config = { show_fan: true, show_swing: true, show_preset: true, ...config };
      this._opt = {};
      this._drag = null;
      this._sheet = null;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._built = false;
      if (this._hass) this.hass = this._hass;
    }
    getCardSize() {
      return 5;
    }
    getGridOptions() {
      return { columns: 6, min_columns: 6, rows: "auto" };
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      this._so = hass.states[this._config.entity];
      this._prune();
      if (!this._built) this._build();
      if (!this._drag) this._render();
    }

    // ---------- optimistic state ----------
    _prune() {
      const so = this._so;
      if (!so) return;
      const now = Date.now();
      for (const k of Object.keys(this._opt)) {
        const cur = k === "state" ? so.state : so.attributes[k];
        if (cur === this._opt[k].v || now - this._opt[k].ts > OPTIMISTIC_TTL) delete this._opt[k];
      }
    }
    _set(k, v) {
      this._opt[k] = { v, ts: Date.now() };
    }
    _val(k) {
      if (this._opt[k]) return this._opt[k].v;
      if (!this._so) return undefined;
      return k === "state" ? this._so.state : this._so.attributes[k];
    }
    _call(service, data) {
      if (this._hass) this._hass.callService("climate", service, { entity_id: this._config.entity, ...data });
    }

    // ---------- DOM ----------
    _build() {
      const root = this.shadowRoot;
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = HolmClimateCard.css();
      root.appendChild(style);

      const particles = Array.from({ length: N_PARTICLES }, (_, i) => {
        const x = ((i * 37) % 100) + (i % 3) * 2;
        const d = 3.2 + ((i * 13) % 10) / 4;
        const delay = -((i * 7) % 23) / 4;
        const s = 3 + ((i * 5) % 4);
        const drift = ((i % 5) - 2) * 6;
        return `<i style="left:${x}%;--d:${d}s;--dl:${delay}s;--s:${s}px;--dx:${drift}px"></i>`;
      }).join("");

      const ticks = Array.from({ length: 28 }, (_, i) => {
        const a = START + (i / 27) * SWEEP;
        const p0 = polar(a, R - 15), p1 = polar(a, R - (i % 3 === 0 ? 20 : 18));
        return `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"/>`;
      }).join("");

      const card = document.createElement("ha-card");
      card.innerHTML = `
        <div class="amb"><div class="glow"></div><div class="fx">${particles}</div></div>
        <div class="wrap">
          <div class="head" id="head">
            <div class="badge"><ha-icon id="bicon"></ha-icon></div>
            <div class="ttl">
              <div class="name" id="name"></div>
              <div class="status"><span class="dot"></span><span id="status"></span></div>
            </div>
          </div>
          <div class="main">
            <div class="dialbox">
              <svg viewBox="0 0 200 200" id="dial">
                <defs>
                  <linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0" id="g0"/><stop offset="1" id="g1"/>
                  </linearGradient>
                </defs>
                <path class="track" d="${arc(START, START + SWEEP)}"/>
                <g class="ticks">${ticks}</g>
                <path class="val" id="val" stroke="url(#g)"/>
                <circle class="cur" id="cur" r="3.2"/>
                <circle class="knob" id="knob" r="10"/>
                <path class="hit" d="${arc(START, START + SWEEP)}"/>
              </svg>
              <div class="center">
                <div class="lbl" id="lbl">Consigne</div>
                <div class="target"><span id="tgt"></span><span class="dec" id="dec"></span><sup>°</sup></div>
                <div class="curtxt"><ha-icon icon="mdi:home-thermometer-outline"></ha-icon><span id="curt"></span></div>
              </div>
              <button class="step minus" id="minus" aria-label="Baisser"><ha-icon icon="mdi:minus"></ha-icon></button>
              <button class="step plus" id="plus" aria-label="Monter"><ha-icon icon="mdi:plus"></ha-icon></button>
            </div>
            <div class="side">
              <div class="modes" id="modes"></div>
              <div class="chips" id="chips"></div>
            </div>
          </div>
        </div>
        <div class="sheet" id="sheet">
          <div class="sheet-in">
            <div class="sheet-h"><span id="sheet-t"></span><button id="sheet-x" aria-label="Fermer"><ha-icon icon="mdi:close"></ha-icon></button></div>
            <div class="opts" id="opts"></div>
          </div>
        </div>
        <div class="na" id="na">Entité indisponible</div>`;
      root.appendChild(card);
      this._card = card;
      const $ = (id) => root.getElementById(id);
      this.$ = $;

      $("head").addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._config.entity }, bubbles: true, composed: true }));
      });
      $("minus").addEventListener("click", (e) => { e.stopPropagation(); this._nudge(-1); });
      $("plus").addEventListener("click", (e) => { e.stopPropagation(); this._nudge(1); });
      $("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") this._closeSheet(); });
      $("sheet-x").addEventListener("click", () => this._closeSheet());

      const dial = $("dial");
      const onMove = (e) => {
        if (!this._drag) return;
        e.preventDefault();
        const t = this._tempFromPointer(e.clientX, e.clientY);
        if (t != null) { this._drag.t = t; this._paintDial(t); }
      };
      const onUp = () => {
        if (!this._drag) return;
        const t = this._drag.t;
        this._drag = null;
        this._card.classList.remove("dragging");
        if (t != null && t !== this._target()) this._commitTemp(t, 0);
        this._render();
      };
      dial.addEventListener("pointerdown", (e) => {
        if (!e.target.classList.contains("hit") && e.target.id !== "knob") return;
        if (this._target() == null) return;
        e.preventDefault();
        this._drag = { t: this._target() };
        this._card.classList.add("dragging");
        dial.setPointerCapture && dial.setPointerCapture(e.pointerId);
        onMove(e);
      });
      dial.addEventListener("pointermove", onMove);
      dial.addEventListener("pointerup", onUp);
      dial.addEventListener("pointercancel", onUp);
      this._built = true;
    }

    // ---------- helpers ----------
    _range() {
      const a = this._so ? this._so.attributes : {};
      const min = Number(a.min_temp ?? 7), max = Number(a.max_temp ?? 35);
      const step = Number(a.target_temp_step || (this._hass?.config?.unit_system?.temperature === "°F" ? 1 : 0.5));
      return { min, max, step };
    }
    _target() {
      const t = this._val("temperature");
      return t == null ? null : Number(t);
    }
    _frac(t) {
      const { min, max } = this._range();
      return max === min ? 0 : clamp((t - min) / (max - min), 0, 1);
    }
    _tempFromPointer(cx, cy) {
      const svg = this.$("dial");
      const r = svg.getBoundingClientRect();
      const sc = 200 / r.width;
      const dx = (cx - r.left) * sc - C, dy = (cy - r.top) * sc - C;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a < 0) a += 360;
      let raw = a - START;
      if (raw < 0) raw += 360;
      if (raw > SWEEP) raw = raw - SWEEP < 360 - raw ? SWEEP : 0;
      const { min, max, step } = this._range();
      return clamp(Math.round((min + (raw / SWEEP) * (max - min)) / step) * step, min, max);
    }
    _nudge(dir) {
      const cur = this._pendingT ?? this._target();
      if (cur == null) return;
      const { min, max, step } = this._range();
      const t = clamp(Math.round((cur + dir * step) / step) * step, min, max);
      this._commitTemp(t, 700);
    }
    _commitTemp(t, delay) {
      this._pendingT = t;
      this._set("temperature", t);
      this._render();
      clearTimeout(this._tTimer);
      this._tTimer = setTimeout(() => {
        this._pendingT = null;
        this._call("set_temperature", { temperature: t });
      }, delay);
    }

    // ---------- render ----------
    _render() {
      const $ = this.$;
      const so = this._so;
      const card = this._card;
      if (!so || so.state === "unavailable") {
        card.classList.add("unavail");
        $("name").textContent = this._config.name || (so && so.attributes.friendly_name) || this._config.entity;
        return;
      }
      card.classList.remove("unavail");
      const a = so.attributes;
      const mode = this._val("state");
      const meta = MODE_META[mode] || MODE_META.off;
      const action = this._opt.state ? (mode === "off" ? "off" : "pending") : a.hvac_action || (mode === "off" ? "off" : null);
      const active = ["heating", "cooling", "drying", "fan", "preheating"].includes(action) || (action == null && mode !== "off") || action === "pending";

      card.dataset.mode = mode;
      card.dataset.fx = mode === "heat" || mode === "cool" ? mode : mode === "off" ? "none" : "soft";
      card.classList.toggle("active", active && mode !== "off");
      card.style.setProperty("--m", meta.rgb);
      const g = ARC_GRAD[mode] || ARC_GRAD.off;
      $("g0").setAttribute("stop-color", g[0]);
      $("g1").setAttribute("stop-color", g[1]);

      $("name").textContent = this._config.name || a.friendly_name || this._config.entity;
      const bicon = mode === "off" ? (this._config.icon || "mdi:air-conditioner") : meta.icon;
      $("bicon").setAttribute("icon", bicon);
      const fm = FAN_META[this._val("fan_mode")];
      card.style.setProperty("--spin", `${fm && fm.speed ? fm.speed : 1.6}s`);

      let status;
      if (mode === "off") status = "Éteint";
      else if (action === "pending") status = meta.label + "…";
      else status = ACTION_LABEL[action] || meta.label;
      $("status").textContent = status;

      const t = this._drag ? this._drag.t : this._target();
      this._paintDial(t);
      const cur = a.current_temperature;
      $("curt").textContent = cur != null ? `${fmt(cur, 0.1)}°` : "–";
      if (cur != null) {
        const p = polar(START + this._frac(Number(cur)) * SWEEP);
        $("cur").setAttribute("cx", p.x.toFixed(1));
        $("cur").setAttribute("cy", p.y.toFixed(1));
        $("cur").style.display = "";
      } else $("cur").style.display = "none";

      this._renderModes(mode, a.hvac_modes || []);
      this._renderChips(a);
      if (this._sheet) this._renderSheet();
    }

    _paintDial(t) {
      const $ = this.$;
      const mode = this._val("state");
      if (t == null) {
        $("tgt").textContent = "–";
        $("dec").textContent = "";
        $("val").setAttribute("d", "");
        $("knob").style.display = "none";
        return;
      }
      $("knob").style.display = "";
      const { step } = this._range();
      const [ip, dp] = fmt(t, step).split(",");
      $("tgt").textContent = ip;
      $("dec").textContent = dp != null ? "," + dp : "";
      const at = START + this._frac(t) * SWEEP;
      // Chauffage : remplissage min → consigne ; clim : consigne → max
      const d = mode === "cool" ? arc(at, START + SWEEP) : arc(START, at);
      $("val").setAttribute("d", d);
      const p = polar(at);
      $("knob").setAttribute("cx", p.x.toFixed(2));
      $("knob").setAttribute("cy", p.y.toFixed(2));
      $("lbl").textContent = mode === "off" ? "Éteint" : "Consigne";
    }

    _renderModes(mode, modes) {
      const box = this.$("modes");
      const list = PRIMARY_MODES.filter((m) => m === "off" || modes.includes(m));
      if (!list.includes(mode) && MODE_META[mode]) list.push(mode);
      const key = list.join(",") + "|" + mode;
      if (box._key === key) return;
      box._key = key;
      box.innerHTML = "";
      list.forEach((m) => {
        const mm = MODE_META[m];
        const b = document.createElement("button");
        b.className = "mode" + (m === mode ? " on" : "");
        b.style.setProperty("--c", mm.rgb);
        b.title = mm.label;
        b.innerHTML = `<ha-icon icon="${mm.icon}"></ha-icon><span>${mm.label}</span>`;
        b.addEventListener("click", () => {
          if (m === this._val("state")) return;
          this._set("state", m);
          this._call("set_hvac_mode", { hvac_mode: m });
          this._render();
        });
        box.appendChild(b);
      });
    }

    _chipDefs(a) {
      const defs = [];
      const cfg = this._config;
      if (cfg.show_fan && a.fan_modes && a.fan_modes.length) {
        const v = this._val("fan_mode");
        const m = FAN_META[v] || { icon: "mdi:fan", label: cap(v) };
        defs.push({ key: "fan", title: "Ventilation", icon: m.icon, label: m.label, spin: true, value: v, options: a.fan_modes, meta: FAN_META, attr: "fan_mode", service: "set_fan_mode" });
      }
      if (cfg.show_preset && a.preset_modes && a.preset_modes.length) {
        const v = this._val("preset_mode") || "none";
        const m = PRESET_META[v] || { icon: "mdi:star-outline", label: cap(v) };
        defs.push({ key: "preset", title: "Préréglage", icon: m.icon, label: m.label, hot: v !== "none", value: v, options: a.preset_modes, meta: PRESET_META, attr: "preset_mode", service: "set_preset_mode" });
      }
      if (cfg.show_swing && a.swing_modes && a.swing_modes.length) {
        const v = this._val("swing_mode");
        const m = SWING_META[v] || { label: cap(v) };
        defs.push({ key: "swing", title: "Oscillation verticale", icon: "mdi:arrow-up-down", label: m.label, hot: v && v !== "stop" && v !== "off", value: v, options: a.swing_modes, meta: SWING_META, attr: "swing_mode", service: "set_swing_mode" });
      }
      if (cfg.show_swing && a.swing_horizontal_modes && a.swing_horizontal_modes.length) {
        const v = this._val("swing_horizontal_mode");
        const m = SWING_META[v] || { icon: "mdi:arrow-left-right", label: cap(v) };
        defs.push({ key: "swingh", title: "Oscillation horizontale", icon: "mdi:arrow-left-right", label: m.label, hot: v && v !== "stop" && v !== "off", value: v, options: a.swing_horizontal_modes, meta: SWING_META, attr: "swing_horizontal_mode", service: "set_swing_horizontal_mode" });
      }
      return defs;
    }

    _renderChips(a) {
      const box = this.$("chips");
      const defs = this._chipDefs(a);
      this._defs = defs;
      box.style.display = defs.length ? "" : "none";
      box.dataset.n = defs.length;
      const key = defs.map((d) => d.key + ":" + d.value + ":" + d.icon).join("|");
      if (box._key === key) return;
      box._key = key;
      box.innerHTML = "";
      defs.forEach((d) => {
        const b = document.createElement("button");
        b.className = "chip" + (d.hot ? " hot" : "") + (d.spin ? " fan" : "");
        b.title = d.title;
        b.innerHTML = `<ha-icon icon="${d.icon}"></ha-icon><span>${d.label}</span>`;
        b.addEventListener("click", () => { this._sheet = d.key; this._renderSheet(); });
        box.appendChild(b);
      });
    }

    _renderSheet() {
      const $ = this.$;
      const d = (this._defs || []).find((x) => x.key === this._sheet);
      if (!d) return this._closeSheet();
      $("sheet-t").textContent = d.title;
      const box = $("opts");
      box.innerHTML = "";
      box.dataset.n = d.options.length;
      d.options.forEach((o) => {
        const m = d.meta[o] || { icon: d.icon, label: cap(o) };
        const b = document.createElement("button");
        b.className = "opt" + (o === d.value ? " on" : "");
        b.innerHTML = `<ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span>`;
        b.addEventListener("click", () => {
          this._set(d.attr, o);
          this._call(d.service, { [d.attr]: o });
          this._closeSheet();
          this._render();
        });
        box.appendChild(b);
      });
      this._card.classList.add("sheet-open");
    }
    _closeSheet() {
      this._sheet = null;
      this._card.classList.remove("sheet-open");
    }

    static css() {
      return `
      :host { display: block; height: 100%; }
      ha-card {
        display: block;
        --m: 150,160,178;
        /* fond toujours sombre : texte clair quel que soit le thème Home Assistant */
        --tx: #e6f2f5;
        --tx2: rgba(220,235,240,.62);
        position: relative; overflow: hidden; height: 100%; box-sizing: border-box;
        container-type: inline-size;
        border-radius: var(--ha-card-border-radius, 20px);
        background: linear-gradient(160deg, rgba(20,28,38,.92), rgba(10,15,22,.96));
        border: 1px solid rgba(var(--m), .18);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04);
        color: var(--tx);
        transition: border-color .6s, box-shadow .6s;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
      }
      ha-card.active { box-shadow: 0 10px 30px rgba(0,0,0,.35), 0 0 22px -6px rgba(var(--m), .45), inset 0 1px 0 rgba(255,255,255,.05); }
      button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; }

      /* ---------- ambiance ---------- */
      .amb { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .glow { position: absolute; inset: 0; opacity: .35; transition: opacity .8s, background .8s; }
      ha-card[data-mode="heat"] .glow { background: radial-gradient(130% 75% at 50% 110%, rgba(255,110,30,.6), rgba(255,80,20,.16) 55%, transparent 78%); }
      ha-card[data-mode="cool"] .glow { background: radial-gradient(120% 70% at 50% -10%, rgba(80,190,255,.5), rgba(60,140,255,.12) 55%, transparent 75%); }
      ha-card[data-fx="soft"] .glow { background: radial-gradient(110% 70% at 50% 50%, rgba(var(--m),.35), transparent 70%); }
      ha-card[data-mode="off"] .glow { background: none; }
      ha-card.active .glow { opacity: .85; animation: breathe 5s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .6; } }

      .fx { position: absolute; inset: 0; opacity: 0; transition: opacity 1s; }
      ha-card.active[data-fx="heat"] .fx, ha-card.active[data-fx="cool"] .fx { opacity: 1; }
      .fx i { position: absolute; width: var(--s); height: var(--s); border-radius: 50%; opacity: 0; }
      ha-card.active[data-fx="heat"] .fx i {
        bottom: -8px; background: radial-gradient(circle, #ffe0a0, #ff7a2a 60%, transparent 70%);
        box-shadow: 0 0 6px 1px rgba(255,120,40,.7);
        animation: rise var(--d) ease-in var(--dl) infinite;
      }
      ha-card.active[data-fx="cool"] .fx i {
        top: -8px; background: radial-gradient(circle, #fff, #bfe9ff 55%, transparent 72%);
        box-shadow: 0 0 5px rgba(170,225,255,.8);
        animation: fall calc(var(--d) * 1.5) linear var(--dl) infinite;
      }
      @keyframes rise {
        0% { transform: translate(0,0) scale(1); opacity: 0; }
        12% { opacity: .9; }
        100% { transform: translate(var(--dx), -260px) scale(.3); opacity: 0; }
      }
      @keyframes fall {
        0% { transform: translate(0,0) rotate(0); opacity: 0; }
        12% { opacity: .85; }
        50% { transform: translate(var(--dx), 160px); }
        100% { transform: translate(calc(var(--dx) * -1), 320px); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) { .fx, .glow { animation: none !important; } .fx { display: none; } }

      /* ---------- layout ---------- */
      .wrap { position: relative; padding: 12px 12px 12px; display: flex; flex-direction: column; gap: 6px; height: 100%; box-sizing: border-box; }
      .head { display: flex; align-items: center; gap: 9px; min-width: 0; cursor: pointer; }
      .badge {
        flex: 0 0 34px; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
        background: rgba(var(--m), .16); color: rgb(var(--m));
        box-shadow: inset 0 0 0 1px rgba(var(--m), .25);
        transition: background .5s, color .5s;
      }
      .badge ha-icon { --mdc-icon-size: 20px; }
      ha-card.active[data-mode="heat"] .badge ha-icon { animation: flick 1.6s ease-in-out infinite; }
      ha-card.active[data-mode="cool"] .badge ha-icon { animation: spin 6s linear infinite; }
      ha-card.active[data-mode="fan_only"] .badge ha-icon { animation: spin var(--spin) linear infinite; }
      @keyframes flick { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(255,140,40,.6)); } 50% { transform: scale(1.1) translateY(-1px); filter: drop-shadow(0 0 6px rgba(255,140,40,.9)); } }
      @keyframes spin { to { transform: rotate(360deg); } }
      .ttl { min-width: 0; flex: 1; }
      .name { font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .status { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--tx2); margin-top: 2px; white-space: nowrap; overflow: hidden; }
      .status span:last-child { overflow: hidden; text-overflow: ellipsis; }
      .dot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: rgba(var(--m), .7); }
      ha-card.active .dot { background: rgb(var(--m)); box-shadow: 0 0 6px rgb(var(--m)); animation: pulse 1.8s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .35; } }

      .main { display: flex; flex-direction: column; gap: 10px; flex: 1; }

      /* ---------- dial ---------- */
      .dialbox { position: relative; width: 100%; max-width: 210px; margin: 0 auto; aspect-ratio: 1; }
      .dialbox > svg { position: absolute; left: 0; top: 0; width: 100%; height: auto; overflow: visible; touch-action: none; }
      .track { fill: none; stroke: rgba(255,255,255,.08); stroke-width: 12; stroke-linecap: round; }
      .ticks line { stroke: rgba(255,255,255,.14); stroke-width: 1.4; stroke-linecap: round; }
      .val { fill: none; stroke-width: 12; stroke-linecap: round; filter: drop-shadow(0 0 5px rgba(var(--m), .55)); transition: d .25s; }
      ha-card[data-mode="off"] .val { filter: none; opacity: .45; }
      .cur { fill: #fff; stroke: rgba(0,0,0,.45); stroke-width: 1.5; }
      .knob { fill: #fff; stroke: rgb(var(--m)); stroke-width: 4; filter: drop-shadow(0 1px 4px rgba(0,0,0,.5)); cursor: grab; }
      ha-card[data-mode="off"] .knob { stroke: #8b93a5; }
      ha-card.dragging .knob { r: 12; }
      .hit { fill: none; stroke: transparent; stroke-width: 34; cursor: pointer; pointer-events: stroke; }

      .center { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-52%); text-align: center; pointer-events: none; }
      .lbl { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--tx2); }
      .target { font-size: 40px; font-weight: 700; line-height: 1.05; letter-spacing: -.03em; font-variant-numeric: tabular-nums; transition: color .4s; white-space: nowrap; }
      .target .dec { font-size: .45em; font-weight: 600; letter-spacing: 0; }
      .target sup { font-size: .42em; font-weight: 500; vertical-align: top; position: relative; top: .3em; margin-left: 1px; color: var(--tx2); }
      ha-card[data-mode="off"] .target { color: rgba(230,240,245,.5); }
      ha-card.dragging .target { color: rgb(var(--m)); }
      .curtxt { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--tx2); margin-top: 2px; }
      .curtxt ha-icon { --mdc-icon-size: 14px; }

      .step {
        position: absolute; top: 88%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        display: grid; place-items: center;
        background: rgba(255,255,255,.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
        transition: background .2s, transform .1s;
      }
      .step:active { transform: scale(.9); background: rgba(var(--m), .3); }
      .step ha-icon { --mdc-icon-size: 18px; }
      .minus { left: 37%; } .plus { left: 63%; }

      /* ---------- modes ---------- */
      .side { display: flex; flex-direction: column; gap: 8px; }
      .modes { display: flex; gap: 4px; padding: 3px; border-radius: 14px; background: rgba(0,0,0,.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
      .mode {
        flex: 1 1 0; min-width: 0; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; gap: 6px;
        color: var(--tx2); transition: background .3s, color .3s, box-shadow .3s;
      }
      .mode ha-icon { --mdc-icon-size: 20px; flex: 0 0 auto; }
      .mode span { display: none; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mode.on { color: #fff; background: linear-gradient(180deg, rgba(var(--c), .95), rgba(var(--c), .7)); box-shadow: 0 3px 12px -2px rgba(var(--c), .6); }
      .mode:not(.on):hover { background: rgba(255,255,255,.06); color: rgb(var(--c)); }

      /* ---------- chips ---------- */
      .chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 5px; }
      .chips[data-n="3"], .chips[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .chips[data-n="3"] .chip:last-child { grid-column: span 2; }
      .chip {
        min-width: 0; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 6px;
        background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.07);
        font-size: 12px; font-weight: 600; color: var(--tx);
      }
      .chip ha-icon { --mdc-icon-size: 16px; flex: 0 0 auto; color: var(--tx2); }
      .chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chip.hot { background: rgba(var(--m), .18); box-shadow: inset 0 0 0 1px rgba(var(--m), .35); }
      .chip.hot ha-icon { color: rgb(var(--m)); }
      ha-card.active .chip.fan ha-icon { color: rgb(var(--m)); animation: spin var(--spin) linear infinite; }
      ha-card[data-mode="off"] .chip { opacity: .7; }

      /* ---------- sheet ---------- */
      .sheet { position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-end; background: rgba(4,8,12,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; pointer-events: none; transition: opacity .2s; }
      ha-card.sheet-open .sheet { opacity: 1; pointer-events: auto; }
      .sheet-in { width: 100%; box-sizing: border-box; padding: 10px; background: rgba(18,26,36,.97); border-top: 1px solid rgba(var(--m), .3); border-radius: 18px 18px 0 0; transform: translateY(20px); transition: transform .22s; }
      ha-card.sheet-open .sheet-in { transform: none; }
      .sheet-h { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--tx2); text-transform: uppercase; letter-spacing: .06em; margin: 0 2px 8px; }
      .sheet-h button { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.07); }
      .sheet-h ha-icon { --mdc-icon-size: 16px; }
      .opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
      .opt { height: 34px; border-radius: 10px; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: rgba(255,255,255,.05); font-size: 12.5px; font-weight: 600; min-width: 0; }
      .opt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .opt ha-icon { --mdc-icon-size: 17px; color: var(--tx2); flex: 0 0 auto; }
      .opt.on { background: rgba(var(--m), .25); box-shadow: inset 0 0 0 1px rgba(var(--m), .55); }
      .opt.on ha-icon { color: rgb(var(--m)); }

      .na { display: none; position: absolute; inset: 0; place-items: center; background: rgba(8,12,18,.8); color: var(--tx2); font-size: 13px; }
      ha-card.unavail .na { display: grid; }

      /* ---------- narrow (2 cartes côte à côte sur mobile) ---------- */
      @container (max-width: 200px) {
        .wrap { padding: 10px 9px 10px; }
        .badge { flex-basis: 30px; width: 30px; height: 30px; border-radius: 10px; }
        .badge ha-icon { --mdc-icon-size: 18px; }
        .name { font-size: 13px; }
        .status { font-size: 11px; }
        .target { font-size: 34px; }
        .step { width: 30px; height: 30px; margin: -15px 0 0 -15px; }
        .minus { left: 36%; } .plus { left: 64%; }
        .lbl { font-size: 9px; }
        .mode { height: 34px; }
        .chip { font-size: 11px; padding: 0 4px; }
        .opts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .opt { font-size: 11.5px; padding: 0 6px; gap: 4px; }
      }
      /* ---------- medium : libellés des modes ---------- */
      @container (min-width: 300px) {
        .mode span { display: inline; }
        .opts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      /* ---------- large : roue à gauche, commandes à droite ---------- */
      @container (min-width: 420px) {
        .main { flex-direction: row; align-items: center; gap: 16px; }
        .dialbox { flex: 0 0 200px; margin: 0; }
        .side { flex: 1; min-width: 0; gap: 10px; }
        .mode { height: 42px; }
        .chip { height: 38px; font-size: 13px; }
        .chips[data-n] { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }
        .chips[data-n="3"] .chip:last-child { grid-column: auto; }
        .chips[data-n="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .opts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      }`;
    }
  }

  class HolmClimateCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (this._form && !this._self) this._form.data = this._config;
    }
    set hass(hass) {
      this._hass = hass;
      this._render();
    }
    connectedCallback() {
      this._render();
    }
    _render() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        const f = document.createElement("ha-form");
        f.schema = [
          { name: "entity", required: true, selector: { entity: { domain: "climate" } } },
          {
            type: "grid", name: "", schema: [
              { name: "name", selector: { text: {} } },
              { name: "icon", selector: { icon: {} } },
            ],
          },
          {
            type: "grid", name: "", schema: [
              { name: "show_fan", selector: { boolean: {} } },
              { name: "show_preset", selector: { boolean: {} } },
              { name: "show_swing", selector: { boolean: {} } },
            ],
          },
        ];
        const L = {
          entity: "Entité climate",
          name: "Nom affiché",
          icon: "Icône (appareil éteint)",
          show_fan: "Ventilation",
          show_preset: "Préréglage (boost…)",
          show_swing: "Oscillation",
        };
        f.computeLabel = (s) => L[s.name] || s.name;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          this._config = ev.detail.value;
          this._self = true;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
          setTimeout(() => (this._self = false), 0);
        });
        this._form = f;
        this.appendChild(f);
      }
      this._form.hass = this._hass;
      this._form.data = { show_fan: true, show_preset: true, show_swing: true, ...this._config };
    }
  }

  if (!customElements.get("holm-climate-card")) {
    customElements.define("holm-climate-card", HolmClimateCard);
    if (!customElements.get("climate-holm-card")) customElements.define("climate-holm-card", class extends HolmClimateCard {});
  }
  if (!customElements.get("holm-climate-card-editor")) customElements.define("holm-climate-card-editor", HolmClimateCardEditor);

  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "holm-climate-card")) {
    window.customCards.push({
      type: "holm-climate-card",
      name: "HOLM Climate",
      description: "Clim/chauffage compacte et animée selon l'usage (éteint, chauffage, clim), lisible à 2 côte à côte sur mobile.",
      preview: true,
    });
  }
  console.info(`%c HOLM-CLIMATE %c ${VERSION} `, "background:#ff8030;color:#111;border-radius:3px 0 0 3px", "background:#123;color:#fff;border-radius:0 3px 3px 0");
})();
