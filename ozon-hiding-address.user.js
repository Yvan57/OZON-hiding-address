// ==UserScript==
// @name         OZON Hiding Address
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Скрытие адреса на страницах ozon.ru: blur, удаление или подмена на случайный адрес
// @author       Yvan57/OZON-hiding-address
// @match        https://www.ozon.ru/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.randomdatatools.ru
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const KEY_SPOOF    = 'ozon_ha_spoof_addr';
    const KEY_BLUR     = 'ozon_ha_blur';
    const KEY_DEL      = 'ozon_ha_del';
    const KEY_SPOOF_ON = 'ozon_ha_spoof_on';
    const KEY_PVZ      = 'ozon_ha_pvz';
    const API_URL      = 'https://api.randomdatatools.ru/?count=1&params=Address';
    const POLL_MS      = 400;

    // Адрес в хедере (правый верхний угол)
    const SEL_ADDR = [
        '[data-widget="addressBookBarWeb"] .checkout_a6o span.tsBody400Small',
        '[data-widget="addressBookBarWeb"] .checkout_oa6 span.tsBody400Small',
        '[data-addressbookbar] .checkout_a6o span.tsBody400Small',
        '[data-addressbookbar] .checkout_oa6 span.tsBody400Small',
        '.checkout_ao9 .checkout_a6o span.tsBody400Small',
        '.checkout_ao9 .checkout_oa6 span.tsBody400Small',
        '.checkout_ap .tsBody400Small',
    ].join(', ');

    // Кандидаты адреса на PDP — фильтруются по содержимому в _getPdpAddressNodes
    const SEL_PDP_ADDR_CANDIDATE = '.q6b3_2_2-a.pdp_t6 span.tsCompact400Small';

    // Контейнеры адреса (для del) — только хедер; PDP обрабатывается отдельно в _applyDel
    const SEL_CONTAINER = [
        '[data-widget="addressBookBarWeb"] .checkout_ao9',
        '[data-addressbookbar] .checkout_ao9',
        '.checkout_o8a.checkout_ao9',
    ].join(', ');

    // Эвристика адреса: содержит адресное слово + цифру, но не содержит символ валюты
    const RE_LOOKS_LIKE_ADDR = /(?:ул\.|пр\.|пер\.|пр-т|бул\.|шоссе|пл\.|наб\.|туп\.|д\.|к\.|кв\.|корп\.|стр\.|влад\.|обл\.|г\.)\s*\d|\d.*(?:,|к\.|корп\.)|,\s*\d/i;
    const RE_NOT_ADDR = /[₽$€]/;

    // Адреса в карточках ПВЗ (открытые и закрытые ПВЗ)
    const SEL_PVZ_ADDR = '.checkout_aq6 .checkout_qa6 span.tsBody400Small, .checkout_a6q .checkout_qa6 span.tsBody400Small';
    // Номера ПВЗ (№ 123-23-43)
    const SEL_PVZ_NUM  = '.checkout_aq7 span.tsBody300XSmall';
    // Адрес ПВЗ содержит запятую — отличает "Москва, ул. ..." от "Срок хранения..." и "Пункт закрыт"
    const RE_PVZ_ADDR  = /,/;

    GM_registerMenuCommand('🔒 Показать кнопку скрипта', () => {
        GM_setValue('ozon_ha_btn_hidden', false);
        const toggle = document.getElementById('ozon-ha-toggle');
        if (toggle) {
            toggle.classList.remove('hidden-mode');
            toggle.style.display = 'flex';
        }
    });

    GM_addStyle(`
        #ozon-ha-box {
            position: fixed; bottom: 70px; right: 15px; width: 300px;
            background: #fff; color: #1a1a1a; font-size: 12px;
            border: 1px solid #e0e0e0; border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,.1); z-index: 999999;
            display: none; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #ozon-ha-header {
            background: linear-gradient(135deg, #005bff, #0041cc);
            padding: 8px 12px; cursor: move; display: flex;
            justify-content: space-between; align-items: center;
            user-select: none; border-radius: 12px 12px 0 0;
            color: #fff; font-size: 13px; font-weight: 600;
        }
        #ozon-ha-close {
            width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,.2); color: #fff; border: none; border-radius: 12px;
            cursor: pointer; font-size: 11px; transition: background .2s;
        }
        #ozon-ha-close:hover { background: rgba(255,255,255,.35); }
        .ha-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .ha-row { display: flex; gap: 6px; align-items: center; }
        .ha-label { font-size: 11px; font-weight: 600; color: #444; min-width: 46px; }
        .ha-divider { border: none; border-top: 1px solid #e9ecef; margin: 2px 0; }
        .ha-section-title { font-size: 10px; color: #999; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
        .ha-btn {
            flex: 1; padding: 6px 4px; border-radius: 8px; cursor: pointer; font-weight: 600;
            font-size: 11px; border: 1.5px solid; transition: all .15s; text-align: center;
            background: #f8f9fa; border-color: #dee2e6; color: #666;
        }
        .ha-btn:hover { background: #f1f3f4; }
        .ha-btn.on-blur  { background: #e7f3ff; border-color: #005bff; color: #005bff; }
        .ha-btn.on-del   { background: #ffe6e6; border-color: #FF3B30; color: #FF3B30; }
        .ha-btn.on-spoof { background: #e8f8ee; border-color: #34C759; color: #248a3d; }
        .ha-btn.on-pvz   { background: #fff3e0; border-color: #FF9500; color: #b96000; }
        .ha-spoof-block { display: none; flex-direction: column; gap: 6px; }
        .ha-spoof-block.visible { display: flex; }
        .ha-spoof-addr {
            font-size: 10px; color: #444; background: #f8f9fa;
            border: 1px solid #e9ecef; border-radius: 6px; padding: 6px;
            word-break: break-word; line-height: 1.4;
            width: 100%; box-sizing: border-box; resize: vertical; min-height: 36px;
            font-family: inherit; outline: none;
        }
        .ha-spoof-addr:focus { border-color: #34C759; }
        .ha-spoof-addr em { color: #999; font-style: normal; }
        .ha-raw-row { display: flex; align-items: center; gap: 5px; }
        .ha-raw-label { font-size: 10px; color: #888; white-space: nowrap; }
        .ha-spoof-row { display: flex; gap: 6px; align-items: center; }
        .ha-refresh {
            padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: 600;
            font-size: 10px; border: 1px solid #34C759; background: #e8f8ee; color: #248a3d;
            transition: all .15s; white-space: nowrap;
        }
        .ha-refresh:hover { background: #d0f0dc; }
        .ha-refresh:disabled { opacity: .5; cursor: default; }
        .ha-reset {
            padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: 600;
            font-size: 10px; border: 1px solid #ffb3b3; background: #ffe6e6; color: #FF3B30;
            transition: all .15s; white-space: nowrap;
        }
        .ha-reset:hover { background: #ffcccc; }
        #ozon-ha-toggle {
            position: fixed; bottom: 15px; right: 15px; width: 50px; height: 50px;
            background: #005bff; color: #fff; border: none; border-radius: 12px;
            z-index: 999998; display: flex; align-items: center; justify-content: center;
            text-align: center; white-space: pre-line; font-size: 11px; cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,91,255,.3); font-weight: 600; transition: all .2s;
        }
        #ozon-ha-toggle:hover { background: #0041cc; transform: translateY(-2px); }
        #ozon-ha-toggle.hidden-mode { opacity: 0; pointer-events: none; }
        .ha-hide-row { display: flex; justify-content: flex-end; }
        .ha-hide-btn {
            font-size: 10px; color: #999; background: none; border: none;
            cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px;
        }
        .ha-hide-btn:hover { color: #555; }
        @keyframes ha-slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        #ozon-ha-box.show { animation: ha-slideIn .2s ease; }
    `);

    const createUI = () => {
        const box = document.createElement('div');
        box.id = 'ozon-ha-box';
        box.innerHTML = `
            <div id="ozon-ha-header">
                <span>🔒 Скрытие адреса</span>
                <button id="ozon-ha-close">✕</button>
            </div>
            <div class="ha-body">
                <span class="ha-section-title">Основной адрес</span>
                <div class="ha-row">
                    <span class="ha-label">Spoof</span>
                    <button class="ha-btn" id="ha-btn-spoof">Подмена адреса</button>
                </div>
                <div class="ha-spoof-block" id="ha-spoof-block">
                    <textarea class="ha-spoof-addr" id="ha-spoof-addr" rows="2" placeholder="Адрес не загружен"></textarea>
                    <div class="ha-spoof-row">
                        <button class="ha-refresh" id="ha-refresh">↺ Новый адрес</button>
                        <div class="ha-raw-row">
                            <input type="checkbox" id="ha-raw-mode">
                            <label class="ha-raw-label" for="ha-raw-mode">Без форматирования</label>
                        </div>
                    </div>
                </div>
                <div class="ha-row">
                    <span class="ha-label">Blur</span>
                    <button class="ha-btn" id="ha-btn-blur">Размытие</button>
                </div>
                <div class="ha-row">
                    <span class="ha-label">Del</span>
                    <button class="ha-btn" id="ha-btn-del">Удаление</button>
                </div>
                <hr class="ha-divider">
                <span class="ha-section-title">Меню выбора ПВЗ</span>
                <div class="ha-row">
                    <span class="ha-label">ПВЗ</span>
                    <button class="ha-btn" id="ha-btn-pvz">Скрыть адреса ПВЗ</button>
                </div>
                <hr class="ha-divider">
                <div class="ha-row" style="justify-content:flex-end; gap:6px;">
                    <button class="ha-reset" id="ha-reset">🗑 Сбросить всё</button>
                </div>
                <div class="ha-hide-row">
                    <button class="ha-hide-btn" id="ha-hide-toggle">Скрыть кнопку (доступна через меню Tampermonkey)</button>
                </div>
            </div>`;
        document.body.appendChild(box);

        const toggle = document.createElement('button');
        toggle.id = 'ozon-ha-toggle';
        toggle.innerHTML = '🔒<br>Адрес';
        document.body.appendChild(toggle);

        return { box, toggle };
    };

    class AddressHider {
        constructor() {
            this.state = {
                spoof: GM_getValue(KEY_SPOOF_ON, false),
                blur:  GM_getValue(KEY_BLUR, false),
                del:   GM_getValue(KEY_DEL, false),
                pvz:   GM_getValue(KEY_PVZ, false),
            };
            this.spoofAddress  = GM_getValue(KEY_SPOOF, '');
            this._origTexts    = new Map(); // spoof: node -> originalText
            this._pvzOrigTexts = new Map(); // pvz spoof: node -> originalText
            this._delNodes     = new Set();
            this._pollTimer    = null;
            this._observer     = null;
            this._spoofLoading = false;

            const { box, toggle } = createUI();
            this.box    = box;
            this.toggle = toggle;
            this.el = {
                btnSpoof:   box.querySelector('#ha-btn-spoof'),
                btnBlur:    box.querySelector('#ha-btn-blur'),
                btnDel:     box.querySelector('#ha-btn-del'),
                btnPvz:     box.querySelector('#ha-btn-pvz'),
                spoofBlock: box.querySelector('#ha-spoof-block'),
                spoofAddr:  box.querySelector('#ha-spoof-addr'),
                refresh:    box.querySelector('#ha-refresh'),
                rawModeChk: box.querySelector('#ha-raw-mode'),
                reset:      box.querySelector('#ha-reset'),
                hideToggle: box.querySelector('#ha-hide-toggle'),
            };

            this._bindEvents();
            this._makeDraggable(box, box.querySelector('#ozon-ha-header'));
            this._startObserver();
            this._updateUI();

            if (this.state.spoof || this.state.blur || this.state.del || this.state.pvz) {
                this._runPoll();
            }
        }

        _bindEvents() {
            const { btnSpoof, btnBlur, btnDel, btnPvz, refresh, reset, hideToggle } = this.el;

            btnSpoof.addEventListener('click', () => this._toggle('spoof'));
            btnBlur.addEventListener('click',  () => this._toggle('blur'));
            btnDel.addEventListener('click',   () => this._toggle('del'));
            btnPvz.addEventListener('click',   () => this._toggle('pvz'));
            refresh.addEventListener('click',  () => this._fetchSpoof());
            reset.addEventListener('click',    () => this._resetAll());

            // Ручное редактирование адреса в textarea
            this.el.spoofAddr.addEventListener('input', () => {
                const val = this.el.spoofAddr.value.trim();
                if (!val) return;
                this.spoofAddress = val;
                GM_setValue(KEY_SPOOF, val);
                if (this.state.spoof || this.state.pvz) this._tick();
            });

            // Чекбокс "Без форматирования" — обновляет отображение текущего адреса
            this.el.rawModeChk.addEventListener('change', () => {
                if (this.spoofAddress) this._updateSpoofLabel(this.spoofAddress);
            });

            hideToggle.addEventListener('click', () => {
                this.toggle.classList.add('hidden-mode');
                this.box.style.display = 'none';
                GM_setValue('ozon_ha_btn_hidden', true);
            });

            this.box.querySelector('#ozon-ha-close').addEventListener('click', () => {
                this.box.style.display = 'none';
                this.toggle.style.display = 'flex';
            });

            this.toggle.addEventListener('click', () => {
                this.box.style.display = 'flex';
                this.box.classList.add('show');
                this.toggle.style.display = 'none';
                setTimeout(() => this.box.classList.remove('show'), 200);
            });

            if (GM_getValue('ozon_ha_btn_hidden', false)) {
                this.toggle.classList.add('hidden-mode');
                // Панель не открываем автоматически — пользователь откроет через меню TM
            }
        }

        _toggle(mode) {
            this.state[mode] = !this.state[mode];
            const keyMap = { spoof: KEY_SPOOF_ON, blur: KEY_BLUR, del: KEY_DEL, pvz: KEY_PVZ };
            GM_setValue(keyMap[mode], this.state[mode]);
            if (!this.state[mode]) this._restoreMode(mode);
            this._updateUI();
            this._managePoll();
            if (this.state[mode]) this._tick();
        }

        _resetAll() {
            ['spoof', 'blur', 'del', 'pvz'].forEach(m => {
                if (this.state[m]) this._restoreMode(m);
                this.state[m] = false;
            });
            GM_setValue(KEY_SPOOF_ON, false);
            GM_setValue(KEY_BLUR, false);
            GM_setValue(KEY_DEL, false);
            GM_setValue(KEY_PVZ, false);
            this._updateUI();
            this._managePoll();
        }

        _restoreMode(mode) {
            if (mode === 'spoof') {
                this._origTexts.forEach((orig, node) => {
                    if (document.contains(node)) node.textContent = orig;
                });
                this._origTexts.clear();
            }
            if (mode === 'blur') {
                document.querySelectorAll('[data-ha-blur]').forEach(n => {
                    n.style.filter = '';
                    n.style.userSelect = '';
                    delete n.dataset.haBlur;
                });
            }
            if (mode === 'del') {
                this._delNodes.forEach(n => {
                    if (document.contains(n)) {
                        n.style.visibility = '';
                        n.style.height = '';
                        n.style.overflow = '';
                        n.style.margin = '';
                        n.style.padding = '';
                        n.style.pointerEvents = '';
                        delete n.dataset.haDel;
                    }
                });
                this._delNodes.clear();
            }
            if (mode === 'pvz') {
                // Восстанавливаем адреса ПВЗ
                this._pvzOrigTexts.forEach((orig, node) => {
                    if (document.contains(node)) node.textContent = orig;
                });
                this._pvzOrigTexts.clear();
                // Восстанавливаем номера ПВЗ
                document.querySelectorAll('[data-ha-pvz-num]').forEach(n => {
                    n.textContent = n.dataset.haPvzNum;
                    delete n.dataset.haPvzNum;
                });
                // Убираем blur с ПВЗ
                document.querySelectorAll('[data-ha-pvz-blur]').forEach(n => {
                    n.style.filter = '';
                    n.style.userSelect = '';
                    delete n.dataset.haPvzBlur;
                });
            }
        }

        _updateUI() {
            const { btnSpoof, btnBlur, btnDel, btnPvz, spoofBlock } = this.el;
            btnSpoof.className = 'ha-btn' + (this.state.spoof ? ' on-spoof' : '');
            btnBlur.className  = 'ha-btn' + (this.state.blur  ? ' on-blur'  : '');
            btnDel.className   = 'ha-btn' + (this.state.del   ? ' on-del'   : '');
            btnPvz.className   = 'ha-btn' + (this.state.pvz   ? ' on-pvz'   : '');
            spoofBlock.classList.toggle('visible', this.state.spoof);
            if (this.state.spoof && this.spoofAddress) this._updateSpoofLabel(this.spoofAddress);
        }

        _managePoll() {
            const anyOn = this.state.spoof || this.state.blur || this.state.del || this.state.pvz;
            if (anyOn && !this._pollTimer) {
                this._runPoll();
            } else if (!anyOn && this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
        }

        _runPoll() {
            this._tick();
            this._pollTimer = setInterval(() => this._tick(), POLL_MS);
        }

        _tick() {
            if (this.state.spoof) this._applySpoof();
            if (this.state.blur)  this._applyBlur();
            if (this.state.del)   this._applyDel();
            if (this.state.pvz)   this._applyPvz();
        }

        _startObserver() {
            this._observer = new MutationObserver(() => {
                if (this.state.spoof || this.state.blur || this.state.del || this.state.pvz) this._tick();
            });
            this._observer.observe(document.body, { childList: true, subtree: true });
        }

        // Убирает квартиру/офис из конца адресной строки: "д. 22 кв.55" → "д. 22"
        _stripApartment(addr) {
            return addr.replace(/[\s,]+(?:кв\.?|оф\.?|офис|apartment|apt\.?)\s*\d+\s*$/i, '').trim();
        }

        // Хедер: улица + дом без города и без квартиры
        _getSpoofText() {
            if (this.el.rawModeChk.checked) return this.spoofAddress;
            return this._stripApartment(this._stripCountryPrefix(this.spoofAddress));
        }

        // ПВЗ: город + улица + дом без страны и без квартиры
        _getSpoofTextPvz() {
            if (this.el.rawModeChk.checked) return this.spoofAddress;
            return this._stripApartment(this._stripCountry(this.spoofAddress));
        }

        _applySpoof() {
            if (!this.spoofAddress) {
                if (!this._spoofLoading) this._fetchSpoof();
                return;
            }
            const addr = this._getSpoofText();
            this._getAddressNodes().forEach(node => {
                if (!this._origTexts.has(node)) this._origTexts.set(node, node.textContent);
                if (node.textContent !== addr) node.textContent = addr;
            });
        }

        _applyBlur() {
            this._getAddressNodes().forEach(node => {
                if (!node.dataset.haBlur) {
                    node.dataset.haBlur = '1';
                    node.style.filter = 'blur(5px)';
                    node.style.userSelect = 'none';
                }
            });
        }

        _hideNode(node) {
            if (node.dataset.haDel) return;
            node.dataset.haDel = '1';
            node.style.visibility = 'hidden';
            node.style.height = '0';
            node.style.overflow = 'hidden';
            node.style.margin = '0';
            node.style.padding = '0';
            node.style.pointerEvents = 'none';
            this._delNodes.add(node);
        }

        _applyDel() {
            // Хедер
            document.querySelectorAll(SEL_CONTAINER).forEach(n => this._hideNode(n));
            // PDP — только контейнеры, чей текст похож на адрес
            this._getPdpAddressContainers().forEach(n => this._hideNode(n));
            // ПВЗ — адресные строки и номера
            document.querySelectorAll('.checkout_aq6 .checkout_qa6, .checkout_a6q .checkout_qa6').forEach(wrap => {
                const span = wrap.querySelector('span.tsBody400Small');
                if (span && RE_PVZ_ADDR.test(span.textContent)) this._hideNode(wrap);
            });
            document.querySelectorAll('.checkout_aq7').forEach(n => this._hideNode(n));
        }

        _applyPvz() {
            // Адреса в карточках ПВЗ (только строки с запятой — т.е. реальный адрес)
            document.querySelectorAll(SEL_PVZ_ADDR).forEach(node => {
                if (!RE_PVZ_ADDR.test(node.textContent)) return;
                if (!this._pvzOrigTexts.has(node)) {
                    this._pvzOrigTexts.set(node, node.textContent);
                }
                if (this.state.spoof && this.spoofAddress) {
                    // Spoof: снимаем blur если был, подменяем текст
                    if (node.dataset.haPvzBlur) {
                        node.style.filter = '';
                        node.style.userSelect = '';
                        delete node.dataset.haPvzBlur;
                    }
                    const addr = this._getSpoofTextPvz();
                    if (node.textContent !== addr) node.textContent = addr;
                } else {
                    // Только pvz без spoof — blur
                    if (!node.dataset.haPvzBlur) {
                        node.dataset.haPvzBlur = '1';
                        node.style.filter = 'blur(5px)';
                        node.style.userSelect = 'none';
                    }
                }
            });

            // Заменяем номера ПВЗ на случайные цифры той же длины и формата
            document.querySelectorAll(SEL_PVZ_NUM).forEach(node => {
                if (!node.dataset.haPvzNum) {
                    node.dataset.haPvzNum = node.textContent;
                    const fake = node.textContent.replace(/\d+/g, seg =>
                        Array.from({ length: seg.length }, () => Math.floor(Math.random() * 10)).join('')
                    );
                    node.textContent = fake;
                }
            });
        }

        _getAddressNodes() {
            return [...document.querySelectorAll(SEL_ADDR), ...this._getPdpAddressNodes()];
        }

        // Узлы span.tsCompact400Small внутри .q6b3_2_2-a.pdp_t6, чей текст похож на адрес
        _getPdpAddressNodes() {
            return [...document.querySelectorAll(SEL_PDP_ADDR_CANDIDATE)]
                .filter(n => RE_LOOKS_LIKE_ADDR.test(n.textContent) && !RE_NOT_ADDR.test(n.textContent));
        }

        // Контейнеры .q6b3_2_2-a.pdp_t6, у которых хотя бы один дочерний span похож на адрес
        _getPdpAddressContainers() {
            const result = [];
            document.querySelectorAll('.q6b3_2_2-a.pdp_t6').forEach(container => {
                const text = container.textContent;
                if (RE_LOOKS_LIKE_ADDR.test(text) && !RE_NOT_ADDR.test(text)) result.push(container);
            });
            return result;
        }

        // Убирает только страну: "Россия, г. Пенза, ул., д." → "г. Пенза, ул., д."
        _stripCountry(full) {
            const m = full.match(/,\s*(г\.?\s+.*)/i);
            if (m) return m[1].trim();
            const parts = full.split(',');
            if (parts.length >= 2) return parts.slice(1).join(',').trim();
            return full;
        }

        // Убирает страну и город: "Россия, г. Пенза, ул., д." → "ул., д."
        _stripCountryPrefix(full) {
            const cityMatch = full.match(/,\s*г\.?\s+[^,]+,\s*(.*)/i);
            if (cityMatch) return cityMatch[1].trim();
            const parts = full.split(',');
            if (parts.length >= 3) return parts.slice(2).join(',').trim();
            return full;
        }

        _fetchSpoof() {
            if (this._spoofLoading) return;
            this._spoofLoading = true;
            const btn = this.el.refresh;
            btn.disabled = true;
            this.el.spoofAddr.value = 'Загрузка...';

            GM_xmlhttpRequest({
                method: 'GET',
                url: API_URL,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const raw = Array.isArray(data) ? data[0]?.Address : data?.Address;
                        if (!raw) throw new Error('no address');
                        this._origTexts.clear();
                        this._pvzOrigTexts.clear();
                        // Убираем pvz-blur чтобы пересмотреть в _applyPvz
                        document.querySelectorAll('[data-ha-pvz-blur]').forEach(n => {
                            n.style.filter = '';
                            n.style.userSelect = '';
                            delete n.dataset.haPvzBlur;
                        });
                        this.spoofAddress = raw;
                        GM_setValue(KEY_SPOOF, raw);
                        this._updateSpoofLabel(raw);
                        if (this.state.spoof || this.state.pvz) this._tick();
                    } catch {
                        this.el.spoofAddr.value = 'Ошибка загрузки';
                    }
                    this._spoofLoading = false;
                    btn.disabled = false;
                },
                onerror: () => {
                    this.el.spoofAddr.value = 'Ошибка сети';
                    this._spoofLoading = false;
                    btn.disabled = false;
                },
            });
        }

        _updateSpoofLabel(raw) {
            const text = this.el.rawModeChk.checked ? raw : this._stripCountryPrefix(raw);
            this.el.spoofAddr.value = text;
        }

        _makeDraggable(element, handle) {
            let dragging = false, ox = 0, oy = 0;
            handle.addEventListener('mousedown', e => {
                if (e.target.closest('#ozon-ha-close')) return;
                dragging = true;
                ox = e.clientX - element.offsetLeft;
                oy = e.clientY - element.offsetTop;
                document.body.style.userSelect = 'none';
            });
            document.addEventListener('mouseup', () => {
                dragging = false;
                document.body.style.userSelect = '';
            });
            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                element.style.left   = Math.max(0, Math.min(window.innerWidth  - element.offsetWidth,  e.clientX - ox)) + 'px';
                element.style.top    = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - oy)) + 'px';
                element.style.right  = 'auto';
                element.style.bottom = 'auto';
            });
        }
    }

    const init = () => {
        if (window.__ozonAddressHider) return;
        try { window.__ozonAddressHider = new AddressHider(); } catch (e) { console.error('OZON HA init error:', e); }
    };

    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    window.addEventListener('beforeunload', () => {
        const h = window.__ozonAddressHider;
        if (h) {
            clearInterval(h._pollTimer);
            if (h._observer) h._observer.disconnect();
        }
    });
})();
