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
 * - Vue compacte (layout: compact), consignes mini / maxi, sonde de température
 *   au choix et graphique de température au toucher
 */
(() => {
  const VERSION = "1.1.0";
  const MODE_META = {
    off: { icon: "mdi:power", rgb: "150,160,178", label: "Éteint" },
    heat: { icon: "mdi:fire", rgb: "255,128,48", label: "Chauffe" },
    cool: { icon: "mdi:snowflake", rgb: "64,190,255", label: "Clim" },
    heat_cool: { icon: "mdi:sun-snowflake-variant", rgb: "185,139,255", label: "Auto" },
    auto: { icon: "mdi:thermostat-auto", rgb: "185,139,255", label: "Auto" },
    dry: { icon: "mdi:water-percent", rgb: "45,217,196", label: "Déshum." },
    fan_only: { icon: "mdi:fan", rgb: "45,212,160", label: "Ventil." },
  };
  const PRIMARY_MODES = ["off", "heat", "cool", "fan_only"];

  // Dégradés de la roue [début, fin]
  const ARC_GRAD = {
    off: ["#6b7385", "#9aa3b5"],
    heat: ["#ffc46b", "#ff5a1f"],
    cool: ["#a8ecff", "#2f86ff"],
    heat_cool: ["#e3d2ff", "#9b6bff"],
    auto: ["#e3d2ff", "#9b6bff"],
    dry: ["#b9fff1", "#16b8a6"],
    fan_only: ["#bff7e2", "#14b884"],
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
      this._config = { show_fan: true, show_swing: true, show_preset: true, layout: "full", graph_hours: 24, ...config };
      this._opt = {};
      this._drag = null;
      this._sheet = null;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._built = false;
      if (this._hass) this.hass = this._hass;
    }
    get _compact() { return this._config && this._config.layout === "compact"; }
    getCardSize() {
      return this._compact ? 2 : 5;
    }
    getGridOptions() {
      return this._compact ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 6, min_columns: 6, rows: "auto" };
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      this._so = hass.states[this._config.entity];
      this._ss = this._config.temperature_sensor ? hass.states[this._config.temperature_sensor] : null;
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
        const y = ((i * 29) % 86) + 6;
        return `<i style="left:${x}%;--y:${y}%;--d:${d}s;--dl:${delay}s;--s:${s}px;--dx:${drift}px"></i>`;
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
            <button class="hcur curbtn" id="hcur" title="Historique de la température"><ha-icon icon="mdi:home-thermometer-outline"></ha-icon><span id="hcurt"></span></button>
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
                <button class="curtxt curbtn" id="curb" title="Historique de la température"><ha-icon icon="mdi:home-thermometer-outline"></ha-icon><span id="curt"></span></button>
              </div>
              <button class="step minus" id="minus" aria-label="Baisser"><ha-icon icon="mdi:minus"></ha-icon></button>
              <button class="step plus" id="plus" aria-label="Monter"><ha-icon icon="mdi:plus"></ha-icon></button>
            </div>
            <div class="side">
              <div class="ctl">
                <div class="modes" id="modes"></div>
                <div class="cstep" id="cstep">
                  <button class="cbtn" id="cminus" aria-label="Baisser"><ha-icon icon="mdi:minus"></ha-icon></button>
                  <div class="ctgt"><span id="ctgt"></span><sup>°</sup></div>
                  <button class="cbtn" id="cplus" aria-label="Monter"><ha-icon icon="mdi:plus"></ha-icon></button>
                </div>
              </div>
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
      const openGraph = (e) => { e.stopPropagation(); this._openGraph(); };
      $("hcur").addEventListener("click", openGraph);
      $("curb").addEventListener("click", openGraph);
      $("cminus").addEventListener("click", (e) => { e.stopPropagation(); this._nudge(-1); });
      $("cplus").addEventListener("click", (e) => { e.stopPropagation(); this._nudge(1); });
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
        if (this._fanOnly()) {
          e.preventDefault();
          const r = dial.getBoundingClientRect(), sc = 200 / r.width;
          let a = (Math.atan2((e.clientY - r.top) * sc - C, (e.clientX - r.left) * sc - C) * 180) / Math.PI;
          if (a < 0) a += 360;
          let raw = a - START; if (raw < 0) raw += 360; if (raw > SWEEP) raw = raw - SWEEP < 360 - raw ? SWEEP : 0;
          const list = this._so.attributes.fan_modes, n = list[Math.round((raw / SWEEP) * (list.length - 1))];
          if (n && n !== this._val("fan_mode")) { this._set("fan_mode", n); this._call("set_fan_mode", { fan_mode: n }); this._render(); }
          return;
        }
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
      let min = Number(a.min_temp ?? 7), max = Number(a.max_temp ?? 35);
      const step = Number(a.target_temp_step || (this._hass?.config?.unit_system?.temperature === "°F" ? 1 : 0.5));
      // consignes mini / maxi de la carte, dans les limites de l'appareil
      const cMin = parseFloat(this._config.min_temp), cMax = parseFloat(this._config.max_temp);
      const lo = isNaN(cMin) ? min : Math.max(min, cMin), hi = isNaN(cMax) ? max : Math.min(max, cMax);
      if (lo < hi) { min = lo; max = hi; }
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
    _fanOnly() {
      return this._val("state") === "fan_only" && this._target() == null && this._so && (this._so.attributes.fan_modes || []).length > 0;
    }
    _nudge(dir) {
      if (this._fanOnly()) {
        const list = this._so.attributes.fan_modes, i = list.indexOf(this._val("fan_mode"));
        const n = list[clamp((i < 0 ? 0 : i) + dir, 0, list.length - 1)];
        if (n && n !== this._val("fan_mode")) { this._set("fan_mode", n); this._call("set_fan_mode", { fan_mode: n }); this._render(); }
        return;
      }
      const cur = this._pendingT ?? this._target();
      if (cur == null) return;
      const { min, max, step } = this._range();
      const t = clamp(Math.round((clamp(cur, min, max) + (cur < min || cur > max ? 0 : dir * step)) / step) * step, min, max);
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
      card.dataset.layout = this._compact ? "compact" : "full";
      card.dataset.fx = mode === "heat" || mode === "cool" ? mode : mode === "fan_only" ? "fan" : mode === "off" ? "none" : "soft";
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
      const cur = this._curTemp();
      $("curt").textContent = cur != null ? `${fmt(cur, 0.1)}°` : "–";
      $("hcurt").textContent = cur != null ? `${fmt(cur, 0.1)}°` : "–";
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

    _curTemp() {
      const ss = this._ss;
      if (this._config.temperature_sensor) {
        const v = ss ? parseFloat(ss.state) : NaN;
        if (!isNaN(v)) return v;
      }
      const c = this._so && this._so.attributes.current_temperature;
      return c == null || isNaN(Number(c)) ? null : Number(c);
    }
    _paintDial(t) {
      const $ = this.$;
      const mode = this._val("state");
      const { step: st } = this._range();
      const fanOnly = this._fanOnly();
      const fanTxt = fanOnly ? (FAN_META[this._val("fan_mode")] || { label: cap(this._val("fan_mode")) }).label : "";
      $("ctgt").textContent = t == null ? (fanOnly ? fanTxt : "–") : fmt(t, st);
      this._card.classList.toggle("fanonly", fanOnly);
      if (t == null && fanOnly) {
        const list = this._so.attributes.fan_modes, i = Math.max(0, list.indexOf(this._val("fan_mode")));
        $("tgt").textContent = fanTxt;
        $("dec").textContent = "";
        $("lbl").textContent = "Ventilation";
        const at = START + (list.length > 1 ? i / (list.length - 1) : 1) * SWEEP;
        $("val").setAttribute("d", arc(START, at));
        const p = polar(at);
        $("knob").style.display = "";
        $("knob").setAttribute("cx", p.x.toFixed(2));
        $("knob").setAttribute("cy", p.y.toFixed(2));
        return;
      }
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
      box.dataset.n = list.length;
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
    _openGraph() {
      let dlg = document.querySelector("holm-climate-graph");
      if (!dlg) { dlg = document.createElement("holm-climate-graph"); document.body.appendChild(dlg); }
      dlg.open(this._hass, {
        entity: this._config.entity,
        sensor: this._config.temperature_sensor || null,
        name: this._config.name || (this._so && this._so.attributes.friendly_name) || this._config.entity,
        hours: Number(this._config.graph_hours) || 24,
      });
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
      ha-card[data-mode="fan_only"] .glow { background: radial-gradient(120% 80% at 0% 50%, rgba(45,212,160,.42), rgba(45,212,160,.1) 55%, transparent 78%); }
      ha-card[data-fx="soft"] .glow { background: radial-gradient(110% 70% at 50% 50%, rgba(var(--m),.35), transparent 70%); }
      ha-card[data-mode="off"] .glow { opacity: .9; background: radial-gradient(120% 80% at 85% 0%, rgba(148,163,184,.22), rgba(100,116,139,.07) 50%, transparent 75%), radial-gradient(90% 60% at 0% 100%, rgba(71,85,105,.25), transparent 70%); animation: breathe 9s ease-in-out infinite; }
      ha-card.active .glow { opacity: .85; animation: breathe 5s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .6; } }

      .fx { position: absolute; inset: 0; opacity: 0; transition: opacity 1s; }
      ha-card.active[data-fx="heat"] .fx, ha-card.active[data-fx="cool"] .fx, ha-card.active[data-fx="fan"] .fx, ha-card[data-fx="none"] .fx { opacity: 1; }
      ha-card[data-fx="none"] .fx i {
        top: var(--y); width: calc(var(--s) * .8); height: calc(var(--s) * .8);
        background: radial-gradient(circle, rgba(203,213,225,.55), transparent 70%);
        animation: dust calc(var(--d) * 4) ease-in-out var(--dl) infinite;
      }
      ha-card[data-fx="none"] .fx i:nth-child(2n) { display: none; }
      @keyframes dust {
        0%, 100% { transform: translate(0, 0); opacity: 0; }
        20% { opacity: .5; }
        50% { transform: translate(var(--dx), -18px); opacity: .35; }
        80% { opacity: .45; }
      }
      ha-card.active[data-fx="fan"] .fx i {
        left: -60px; top: var(--y); width: calc(var(--s) * 9); height: 2px; border-radius: 2px;
        background: linear-gradient(90deg, transparent, rgba(170,255,225,.75), transparent);
        animation: breeze calc(var(--d) * var(--spin-k, .7)) linear var(--dl) infinite;
      }
      @keyframes breeze {
        0% { transform: translateX(0) translateY(0); opacity: 0; }
        15% { opacity: .85; }
        50% { transform: translateX(60cqw) translateY(calc(var(--dx) * .5)); }
        100% { transform: translateX(125cqw) translateY(0); opacity: 0; }
      }
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
      ha-card.fanonly .target { font-size: 30px; color: rgb(var(--m)); }
      ha-card.fanonly .ctgt { font-size: 17px; color: rgb(var(--m)); min-width: 64px; }
      ha-card.fanonly .target sup, ha-card.fanonly .ctgt sup, ha-card.fanonly .cur { display: none; }
      .curtxt { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--tx2); margin-top: 2px; pointer-events: auto; padding: 2px 7px; border-radius: 9px; }
      .curbtn { cursor: pointer; transition: background .2s, color .2s; }
      .curbtn:hover { background: rgba(255,255,255,.08); color: var(--tx); }
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

      /* ---------- vue compacte ---------- */
      .hcur, .cstep { display: none; }
      .ctl { display: flex; flex-direction: column; gap: 8px; }
      ha-card[data-layout="compact"] .dialbox { display: none; }
      /* ligne 1 : nom · température · consigne — ligne 2 : modes · options */
      ha-card[data-layout="compact"] .wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 10px; padding: 10px 12px; }
      ha-card[data-layout="compact"] .main, ha-card[data-layout="compact"] .side, ha-card[data-layout="compact"] .ctl { display: contents; }
      ha-card[data-layout="compact"] .head { grid-column: 1; grid-row: 1; min-width: 0; }
      ha-card[data-layout="compact"] .cstep { grid-column: 2; grid-row: 1; }
      ha-card[data-layout="compact"] .modes { grid-column: 1; grid-row: 2; min-width: 0; }
      ha-card[data-layout="compact"] .chips { grid-column: 2; grid-row: 2; display: flex; gap: 5px; }
      ha-card[data-layout="compact"] .side:has(.chips[data-n="0"]) .modes { grid-column: 1 / -1; }
      ha-card[data-layout="compact"] .cstep, ha-card[data-layout="compact"] .chips { justify-self: end; }
      /* 3 options ou plus : sur leur propre ligne, pleine largeur */
      ha-card[data-layout="compact"] .chips:is([data-n="3"], [data-n="4"]) { grid-column: 1 / -1; grid-row: 3; justify-self: stretch; }
      ha-card[data-layout="compact"] .chips:is([data-n="3"], [data-n="4"]) .chip { flex: 1 1 0; min-width: 0; }
      ha-card[data-layout="compact"] .side:has(.chips:is([data-n="3"], [data-n="4"])) .modes { grid-column: 1 / -1; }
      ha-card[data-layout="compact"] .hcur { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; height: 30px; padding: 0 8px; margin-left: auto; border-radius: 10px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.07); }
      ha-card[data-layout="compact"] .hcur ha-icon { --mdc-icon-size: 16px; color: var(--tx2); }
      ha-card[data-layout="compact"] .cstep { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 13px; background: rgba(0,0,0,.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
      ha-card[data-layout="compact"] .mode { height: 34px; }
      ha-card[data-layout="compact"] .mode span { display: none; }
      ha-card[data-layout="compact"] .chip { height: 34px; padding: 0 9px; flex: 0 1 auto; }
      .cbtn { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: rgba(255,255,255,.06); transition: background .2s, transform .1s; }
      .cbtn:active { transform: scale(.92); background: rgba(var(--m), .3); }
      .cbtn ha-icon { --mdc-icon-size: 17px; }
      .ctgt { min-width: 50px; text-align: center; font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
      .ctgt sup { font-size: .5em; color: var(--tx2); font-weight: 500; }
      ha-card[data-mode="off"] .ctgt { color: rgba(230,240,245,.5); }
      /* très étroit : options sous les modes */
      @container (max-width: 360px) {
        ha-card[data-layout="compact"] .chips { grid-column: 1 / -1; grid-row: 3; justify-self: stretch; }
        ha-card[data-layout="compact"] .chip { flex: 1 1 0; min-width: 0; }
        ha-card[data-layout="compact"] .modes { grid-column: 1 / -1; }
        ha-card[data-layout="compact"] .hcur { display: none; }
        ha-card[data-layout="compact"] .status { overflow: visible; }
        ha-card[data-layout="compact"] .chips[data-n="4"] .chip span { display: none; }
        ha-card[data-layout="compact"] .chips[data-n="4"] .chip ha-icon { --mdc-icon-size: 20px; }
      }
      @container (min-width: 520px) {
        ha-card[data-layout="compact"] .mode span { display: inline; }
      }
      /* large : tout sur une ligne */
      @container (min-width: 760px) {
        ha-card[data-layout="compact"] .wrap { grid-template-columns: minmax(170px, 1fr) minmax(0, auto) auto auto; }
        ha-card[data-layout="compact"] .head { grid-column: 1; grid-row: 1; }
        ha-card[data-layout="compact"] .modes { grid-column: 2; grid-row: 1; }
        ha-card[data-layout="compact"] .cstep { grid-column: 3; grid-row: 1; }
        ha-card[data-layout="compact"] .chips { grid-column: 4; grid-row: 1; }
        ha-card[data-layout="compact"] .side:has(.chips[data-n="0"]) .modes { grid-column: 2; }
        ha-card[data-layout="compact"] .side:has(.chips:is([data-n="3"], [data-n="4"])) .modes { grid-column: 2; }
        ha-card[data-layout="compact"] .chips:is([data-n="3"], [data-n="4"]) { grid-column: 2 / -1; grid-row: 2; justify-self: end; }
        ha-card[data-layout="compact"] .chips:is([data-n="3"], [data-n="4"]) .chip { flex: 0 1 auto; }
        ha-card[data-layout="compact"] .mode { height: 38px; padding: 0 10px; }
        ha-card[data-layout="compact"] .chip { height: 38px; }
      }
      @container (min-width: 760px) and (max-width: 1000px) {
        ha-card[data-layout="compact"] .modes[data-n="4"] .mode span { display: none; }
      }

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
        .modes[data-n="4"] .mode span { display: none; }
        .opts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @container (min-width: 600px) { .modes[data-n="4"] .mode span { display: inline; } }
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
          { name: "layout", selector: { select: { mode: "dropdown", options: [{ value: "full", label: "Complète (avec la roue)" }, { value: "compact", label: "Compacte (en largeur, sans la roue)" }] } } },
          {
            type: "grid", name: "", schema: [
              { name: "min_temp", selector: { number: { min: 5, max: 35, step: 0.5, mode: "box", unit_of_measurement: "°C" } } },
              { name: "max_temp", selector: { number: { min: 5, max: 35, step: 0.5, mode: "box", unit_of_measurement: "°C" } } },
            ],
          },
          { name: "temperature_sensor", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
          { name: "graph_hours", selector: { number: { min: 1, max: 168, step: 1, mode: "box", unit_of_measurement: "h" } } },
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
          layout: "Présentation",
          min_temp: "Consigne minimum",
          max_temp: "Consigne maximum",
          temperature_sensor: "Sonde de température (sinon celle de l'appareil)",
          graph_hours: "Durée du graphique par défaut",
        };
        f.computeLabel = (s) => L[s.name] || s.name;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const v = { ...ev.detail.value };
          for (const k of ["min_temp", "max_temp", "temperature_sensor", "name", "icon"]) if (v[k] === "" || v[k] == null) delete v[k];
          if (v.layout === "full") delete v.layout;
          if (Number(v.graph_hours) === 24) delete v.graph_hours;
          this._config = v;
          this._self = true;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
          setTimeout(() => (this._self = false), 0);
        });
        this._form = f;
        this.appendChild(f);
      }
      this._form.hass = this._hass;
      this._form.data = { show_fan: true, show_preset: true, show_swing: true, layout: "full", graph_hours: 24, ...this._config };
    }
  }


  // ======================================================================
  // Fenêtre « historique de la température » (ouverte au toucher sur la température)
  class HolmClimateGraph extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._onKey = (e) => { if (e.key === "Escape") this.close(); };
      this._onResize = () => this._draw();
    }
    open(hass, o) {
      this._hass = hass;
      this._o = o;
      this._hours = o.hours;
      this._data = null;
      this._build();
      document.addEventListener("keydown", this._onKey);
      window.addEventListener("resize", this._onResize);
      requestAnimationFrame(() => this.shadowRoot.querySelector(".bg").classList.add("on"));
      this._load();
    }
    close() {
      document.removeEventListener("keydown", this._onKey);
      window.removeEventListener("resize", this._onResize);
      const bg = this.shadowRoot.querySelector(".bg");
      if (bg) bg.classList.remove("on");
      setTimeout(() => { this.shadowRoot.innerHTML = ""; }, 220);
    }
    _build() {
      const R = [[6, "6 h"], [24, "24 h"], [48, "48 h"], [168, "7 j"]];
      if (!R.some(([h]) => h === this._hours)) R.push([this._hours, this._hours % 24 === 0 ? this._hours / 24 + " j" : this._hours + " h"]);
      R.sort((a, b) => a[0] - b[0]);
      this.shadowRoot.innerHTML = `<style>${HolmClimateGraph.css()}</style>
        <div class="bg"><div class="dlg" role="dialog" aria-label="Historique de la température">
          <div class="hd"><div class="tt"><b>${this._esc(this._o.name)}</b><small>Température${this._o.sensor ? " · sonde" : ""}</small></div>
            <div class="rg">${R.map(([h, l]) => `<button data-h="${h}" class="${h === this._hours ? "on" : ""}">${l}</button>`).join("")}</div>
            <button class="x" aria-label="Fermer"><ha-icon icon="mdi:close"></ha-icon></button></div>
          <div class="stats" id="stats"></div>
          <div class="ch" id="ch"><div class="ld">Chargement…</div></div>
          <div class="lg"><span><i class="lt"></i>Température</span><span><i class="lc"></i>Consigne</span><span><i class="lh"></i>Chauffe</span><span><i class="lk"></i>Clim</span></div>
        </div></div>`;
      const r = this.shadowRoot;
      r.querySelector(".bg").addEventListener("click", (e) => { if (e.target.classList.contains("bg")) this.close(); });
      r.querySelector(".x").addEventListener("click", () => this.close());
      r.querySelectorAll(".rg button").forEach((b) => b.addEventListener("click", () => {
        this._hours = Number(b.dataset.h);
        r.querySelectorAll(".rg button").forEach((x) => x.classList.toggle("on", x === b));
        this._load();
      }));
    }
    _esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
    async _load() {
      const seq = (this._seq = (this._seq || 0) + 1);
      const end = new Date(), start = new Date(end - this._hours * 3600e3);
      const ch = this.shadowRoot.getElementById("ch");
      if (ch && !this._data) ch.innerHTML = `<div class="ld">Chargement…</div>`;
      try {
        const base = { type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(), significant_changes_only: false };
        const [cl, se] = await Promise.all([
          this._hass.callWS({ ...base, entity_ids: [this._o.entity], minimal_response: false, no_attributes: false }),
          this._o.sensor ? this._hass.callWS({ ...base, entity_ids: [this._o.sensor], minimal_response: true, no_attributes: true }) : null,
        ]);
        if (seq !== this._seq) return;
        const t = (x) => (x.lu != null ? x.lu : x.lc) * 1000;
        const rows = (cl && cl[this._o.entity]) || [];
        let attrs = {};
        const clim = rows.map((x) => { if (x.a) attrs = { ...attrs, ...x.a }; return { t: t(x), s: x.s, a: attrs }; });
        const temp = this._o.sensor
          ? ((se && se[this._o.sensor]) || []).map((x) => ({ t: t(x), v: parseFloat(x.s) })).filter((p) => !isNaN(p.v))
          : clim.map((x) => ({ t: x.t, v: Number(x.a.current_temperature) })).filter((p) => !isNaN(p.v) && p.v !== 0);
        const target = clim.map((x) => ({ t: x.t, v: x.s === "off" || x.s === "unavailable" || x.a.temperature == null ? null : Number(x.a.temperature) }));
        const bands = [];
        clim.forEach((x, i) => {
          const act = x.a.hvac_action || (x.s === "heat" ? "heating" : x.s === "cool" ? "cooling" : null);
          const k = act === "heating" || act === "preheating" ? "heat" : act === "cooling" ? "cool" : null;
          const t1 = i + 1 < clim.length ? clim[i + 1].t : +end;
          if (k) { const last = bands[bands.length - 1]; if (last && last.k === k && last.t1 >= x.t) last.t1 = t1; else bands.push({ k, t0: x.t, t1 }); }
        });
        this._data = { t0: +start, t1: +end, temp, target, bands };
        this._draw();
      } catch (e) {
        if (ch) ch.innerHTML = `<div class="ld">Historique indisponible : ${this._esc(e && e.message ? e.message : e)}</div>`;
      }
    }
    _draw() {
      const d = this._data, ch = this.shadowRoot.getElementById("ch");
      if (!d || !ch) return;
      const W = Math.max(280, ch.clientWidth || 600), H = Math.round(Math.min(340, Math.max(200, W * 0.45)));
      const P = { l: 34, r: 12, t: 10, b: 24 };
      const vals = [...d.temp.map((p) => p.v), ...d.target.filter((p) => p.v != null).map((p) => p.v)];
      const st = this.shadowRoot.getElementById("stats");
      if (!d.temp.length) { ch.innerHTML = `<div class="ld">Aucune donnée de température sur cette période.</div>`; st.innerHTML = ""; return; }
      let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
      if (hi - lo < 3) { const m = (hi + lo) / 2; lo = Math.floor(m - 1.5); hi = Math.ceil(m + 1.5); }
      const x = (t) => P.l + ((t - d.t0) / (d.t1 - d.t0)) * (W - P.l - P.r);
      const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
      const fr = (v) => Number(v).toFixed(1).replace(".", ",");
      // axes
      const ys = []; const yStep = hi - lo > 12 ? 4 : hi - lo > 6 ? 2 : 1;
      for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) ys.push(v);
      const hStep = this._hours <= 6 ? 1 : this._hours <= 24 ? 3 : this._hours <= 48 ? 6 : 24;
      const xs = []; const f = new Date(d.t0); f.setMinutes(0, 0, 0);
      for (let t = +f; t <= d.t1; t += 3600e3) { const dt = new Date(t); if (t >= d.t0 && (hStep === 24 ? dt.getHours() === 0 : dt.getHours() % hStep === 0)) xs.push(t); }
      const lbl = (t) => { const dt = new Date(t); return hStep === 24 ? dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }) : dt.getHours() + "h"; };
      // courbes
      const pts = d.temp.map((p) => [x(Math.max(p.t, d.t0)), y(p.v)]);
      pts.push([x(d.t1), pts[pts.length - 1][1]]);
      const line = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
      const area = line + ` L${x(d.t1).toFixed(1)} ${H - P.b} L${pts[0][0].toFixed(1)} ${H - P.b} Z`;
      let tg = "", prev = null;
      d.target.forEach((p, i) => {
        const t0 = Math.max(p.t, d.t0), t1 = i + 1 < d.target.length ? d.target[i + 1].t : d.t1;
        if (p.v == null || t1 <= d.t0) { prev = null; return; }
        tg += (prev == null ? `M${x(t0).toFixed(1)} ${y(p.v).toFixed(1)}` : ` L${x(t0).toFixed(1)} ${y(p.v).toFixed(1)}`) + ` L${x(t1).toFixed(1)} ${y(p.v).toFixed(1)}`;
        prev = p.v;
      });
      const bands = d.bands.map((b) => { const a = x(Math.max(b.t0, d.t0)), z = x(Math.min(b.t1, d.t1)); return z > a ? `<rect class="b${b.k}" x="${a.toFixed(1)}" y="${P.t}" width="${(z - a).toFixed(1)}" height="${H - P.t - P.b}"/>` : ""; }).join("");
      ch.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a4a" stop-opacity=".35"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></linearGradient></defs>
        ${bands}
        ${ys.map((v) => `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yl" x="${P.l - 6}" y="${(y(v) + 3.5).toFixed(1)}">${v}°</text>`).join("")}
        ${xs.map((t) => `<text class="xl" x="${x(t).toFixed(1)}" y="${H - 6}">${lbl(t)}</text>`).join("")}
        <path class="ar" d="${area}"/>
        ${tg ? `<path class="tg" d="${tg}"/>` : ""}
        <path class="ln" d="${line}"/>
        <g class="hv" style="display:none"><line class="hl" y1="${P.t}" y2="${H - P.b}"/><circle r="4"/></g>
      </svg><div class="tip" style="display:none"></div>`;
      const tv = d.temp.map((p) => p.v);
      const avg = tv.reduce((a, b) => a + b, 0) / tv.length;
      const heatMin = d.bands.filter((b) => b.k === "heat").reduce((a, b) => a + (Math.min(b.t1, d.t1) - Math.max(b.t0, d.t0)), 0) / 60000;
      const coolMin = d.bands.filter((b) => b.k === "cool").reduce((a, b) => a + (Math.min(b.t1, d.t1) - Math.max(b.t0, d.t0)), 0) / 60000;
      const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`);
      st.innerHTML = `<div><small>Actuelle</small><b>${fr(tv[tv.length - 1])}°</b></div><div><small>Min</small><b>${fr(Math.min(...tv))}°</b></div><div><small>Max</small><b>${fr(Math.max(...tv))}°</b></div><div><small>Moyenne</small><b>${fr(avg)}°</b></div>${heatMin > 0.5 ? `<div><small>Chauffe</small><b>${dur(heatMin)}</b></div>` : ""}${coolMin > 0.5 ? `<div><small>Clim</small><b>${dur(coolMin)}</b></div>` : ""}`;
      // survol
      const svg = ch.querySelector("svg"), hv = ch.querySelector(".hv"), tip = ch.querySelector(".tip");
      const at = (arr, t) => { let r = null; for (const p of arr) { if (p.t <= t) r = p; else break; } return r; };
      const show = (ev) => {
        const rc = svg.getBoundingClientRect();
        const px = ((ev.clientX - rc.left) / rc.width) * W;
        if (px < P.l || px > W - P.r) { hv.style.display = "none"; tip.style.display = "none"; return; }
        const t = d.t0 + ((px - P.l) / (W - P.l - P.r)) * (d.t1 - d.t0);
        const p = at(d.temp, t) || d.temp[0], c = at(d.target, t);
        hv.style.display = ""; hv.querySelector("line").setAttribute("x1", px); hv.querySelector("line").setAttribute("x2", px);
        hv.querySelector("circle").setAttribute("cx", px); hv.querySelector("circle").setAttribute("cy", y(p.v));
        tip.style.display = "";
        tip.innerHTML = `<small>${new Date(t).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</small><b>${fr(p.v)}°</b>${c && c.v != null ? `<span>consigne ${fr(c.v)}°</span>` : ""}`;
        const tx = (px / W) * rc.width;
        tip.style.left = `${Math.min(Math.max(tx, 60), rc.width - 60)}px`;
      };
      svg.addEventListener("pointermove", show);
      svg.addEventListener("pointerdown", show);
      svg.addEventListener("pointerleave", () => { hv.style.display = "none"; tip.style.display = "none"; });
    }
    static css() {
      return `
      .bg { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
        background: rgba(4,8,12,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; transition: opacity .2s;
        font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, system-ui, sans-serif)); }
      .bg.on { opacity: 1; }
      .dlg { width: 100%; max-width: 760px; max-height: 100%; overflow: auto; box-sizing: border-box; padding: 16px; border-radius: 22px; color: #e6f2f5;
        background: linear-gradient(160deg, rgba(22,30,40,.98), rgba(10,15,22,.99)); border: 1px solid rgba(255,255,255,.08); box-shadow: 0 20px 60px rgba(0,0,0,.5);
        transform: translateY(12px) scale(.98); transition: transform .22s; }
      .bg.on .dlg { transform: none; }
      button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; }
      .hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .tt { flex: 1; min-width: 140px; display: flex; flex-direction: column; } .tt b { font-size: 16px; } .tt small { font-size: 12px; color: rgba(220,235,240,.62); }
      .rg { display: flex; gap: 3px; padding: 3px; border-radius: 12px; background: rgba(0,0,0,.3); }
      .rg button { height: 30px; padding: 0 10px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: rgba(220,235,240,.7); }
      .rg button.on { color: #fff; background: rgba(255,128,48,.85); }
      .x { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.07); }
      .x ha-icon { --mdc-icon-size: 18px; }
      .stats { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 8px; }
      .stats div { flex: 1 1 80px; padding: 7px 10px; border-radius: 12px; background: rgba(255,255,255,.05); display: flex; flex-direction: column; }
      .stats small { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: rgba(220,235,240,.6); }
      .stats b { font-size: 17px; font-variant-numeric: tabular-nums; }
      .ch { position: relative; min-height: 200px; }
      .ch svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
      .ld { display: grid; place-items: center; min-height: 200px; font-size: 13px; color: rgba(220,235,240,.62); text-align: center; }
      .gl { stroke: rgba(255,255,255,.07); } .yl, .xl { fill: rgba(220,235,240,.55); font-size: 10.5px; } .yl { text-anchor: end; } .xl { text-anchor: middle; }
      .ar { fill: url(#ga); } .ln { fill: none; stroke: #ff9a4a; stroke-width: 2.2; stroke-linejoin: round; }
      .tg { fill: none; stroke: rgba(255,255,255,.75); stroke-width: 1.5; stroke-dasharray: 5 4; }
      .bheat { fill: rgba(255,110,30,.13); } .bcool { fill: rgba(64,170,255,.14); }
      .hl { stroke: rgba(255,255,255,.35); stroke-dasharray: 3 3; } .hv circle { fill: #fff; stroke: #ff9a4a; stroke-width: 2; }
      .tip { position: absolute; top: 4px; transform: translateX(-50%); padding: 6px 9px; border-radius: 10px; background: rgba(15,22,30,.95); box-shadow: 0 6px 18px rgba(0,0,0,.4);
        display: flex; flex-direction: column; align-items: center; pointer-events: none; font-size: 12px; white-space: nowrap; }
      .tip small { color: rgba(220,235,240,.6); font-size: 11px; } .tip b { font-size: 15px; } .tip span { color: rgba(220,235,240,.75); font-size: 11px; }
      .lg { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 11.5px; color: rgba(220,235,240,.65); }
      .lg span { display: flex; align-items: center; gap: 5px; } .lg i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
      .lt { background: #ff9a4a; } .lc { background: repeating-linear-gradient(90deg, #fff 0 4px, transparent 4px 7px); } .lh { height: 9px !important; background: rgba(255,110,30,.35); } .lk { height: 9px !important; background: rgba(64,170,255,.4); }
      @media (max-width: 480px) { .bg { padding: 8px; align-items: flex-end; } .dlg { border-radius: 22px 22px 14px 14px; padding: 12px; } }`;
    }
  }
  if (!customElements.get("holm-climate-graph")) customElements.define("holm-climate-graph", HolmClimateGraph);

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
