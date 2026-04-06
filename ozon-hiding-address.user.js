// ==UserScript==
// @name         OZON Hiding Address
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Скрытие адреса на страницах ozon.ru: blur, удаление или подмена на случайный адрес
// @author       Yvan57/OZON-hiding-address
// @match        https://www.ozon.ru/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.randomdatatools.ru
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // Ключи хранилища
    const KEY_SPOOF  = 'ozon_ha_spoof_addr';
    const KEY_BLUR   = 'ozon_ha_blur';
    const KEY_DEL    = 'ozon_ha_del';
    const KEY_SPOOF_ON = 'ozon_ha_spoof_on';
    const API_URL    = 'https://api.randomdatatools.ru/?count=1&params=Address';
    const POLL_MS    = 400;

    // Селекторы узлов с текстом адреса (только span с самим текстом)
    const SEL_ADDR = [
        '[data-widget="addressBookBarWeb"] .checkout_a6o span.tsBody400Small',
        '[data-addressbookbar] .checkout_a6o span.tsBody400Small',
        '.checkout_ao9 .checkout_a6o span.tsBody400Small',
        '.q6b3_2_2-a span.tsCompact400Small',
        '.pdp_t6 span.tsCompact400Small',
    ].join(', ');

    // Селекторы блоков-контейнеров адреса (для del — скрываем целиком)
    const SEL_CONTAINER = [
        '[data-widget="addressBookBarWeb"] .checkout_ao9',
        '[data-addressbookbar] .checkout_ao9',
        '.checkout_ao9',
        '.q6b3_2_2-a',
        '.pdp_t6',
    ].join(', ');

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
        .ha-btn {
            flex: 1; padding: 6px 4px; border-radius: 8px; cursor: pointer; font-weight: 600;
            font-size: 11px; border: 1.5px solid; transition: all .15s; text-align: center;
            background: #f8f9fa; border-color: #dee2e6; color: #666;
        }
        .ha-btn:hover { background: #f1f3f4; }
        .ha-btn.on-blur  { background: #e7f3ff; border-color: #005bff; color: #005bff; }
        .ha-btn.on-del   { background: #ffe6e6; border-color: #FF3B30; color: #FF3B30; }
        .ha-btn.on-spoof { background: #e8f8ee; border-color: #34C759; color: #248a3d; }
        .ha-spoof-block { display: none; flex-direction: column; gap: 6px; }
        .ha-spoof-block.visible { display: flex; }
        .ha-spoof-addr {
            font-size: 10px; color: #444; background: #f8f9fa;
            border: 1px solid #e9ecef; border-radius: 6px; padding: 6px;
            word-break: break-word; line-height: 1.4;
        }
        .ha-spoof-addr em { color: #999; font-style: normal; }
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
        #ozon-ha-toggle.hidden-mode {
            opacity: 0; pointer-events: none;
        }
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
                <div class="ha-row">
                    <span class="ha-label">Spoof</span>
                    <button class="ha-btn" id="ha-btn-spoof">Подмена адреса</button>
                </div>
                <div class="ha-spoof-block" id="ha-spoof-block">
                    <div class="ha-spoof-addr" id="ha-spoof-addr"><em>Адрес не загружен</em></div>
                    <div class="ha-spoof-row">
                        <button class="ha-refresh" id="ha-refresh">↺ Новый адрес</button>
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
            // Состояние каждого режима независимо
            this.state = {
                spoof: GM_getValue(KEY_SPOOF_ON, false),
                blur:  GM_getValue(KEY_BLUR, false),
                del:   GM_getValue(KEY_DEL, false),
            };
            this.spoofAddress = GM_getValue(KEY_SPOOF, '');
            // Оригинальные тексты для восстановления при сбросе spoof
            this._origTexts = new Map();
            // Узлы, скрытые через del
            this._delNodes = new Set();
            this._pollTimer = null;
            this._observer = null;

            const { box, toggle } = createUI();
            this.box = box;
            this.toggle = toggle;
            this.el = {
                btnSpoof:   box.querySelector('#ha-btn-spoof'),
                btnBlur:    box.querySelector('#ha-btn-blur'),
                btnDel:     box.querySelector('#ha-btn-del'),
                spoofBlock: box.querySelector('#ha-spoof-block'),
                spoofAddr:  box.querySelector('#ha-spoof-addr'),
                refresh:    box.querySelector('#ha-refresh'),
                reset:      box.querySelector('#ha-reset'),
                hideToggle: box.querySelector('#ha-hide-toggle'),
            };

            this._bindEvents();
            this._makeDraggable(box, box.querySelector('#ozon-ha-header'));
            this._startObserver();
            this._updateUI();

            // Запускаем poll только если хоть что-то включено
            if (this.state.spoof || this.state.blur || this.state.del) {
                this._runPoll();
            }
        }

        _bindEvents() {
            const { btnSpoof, btnBlur, btnDel, refresh, reset, hideToggle } = this.el;

            btnSpoof.addEventListener('click', () => this._toggle('spoof'));
            btnBlur.addEventListener('click',  () => this._toggle('blur'));
            btnDel.addEventListener('click',   () => this._toggle('del'));

            refresh.addEventListener('click', () => this._fetchSpoof());

            reset.addEventListener('click', () => {
                this._resetAll();
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

            // Восстановление кнопки через Tampermonkey menu — при любом клике по странице
            // кнопка становится видима снова если пользователь через консоль/TM сбросит флаг
            // Здесь просто не прячем навсегда: кнопка восстанавливается при перезагрузке если флаг сброшен
            if (GM_getValue('ozon_ha_btn_hidden', false)) {
                this.toggle.classList.add('hidden-mode');
                // Показываем box сразу без кнопки
                this.box.style.display = 'flex';
            }
        }

        _toggle(mode) {
            const was = this.state[mode];
            this.state[mode] = !was;

            const keyMap = { spoof: KEY_SPOOF_ON, blur: KEY_BLUR, del: KEY_DEL };
            GM_setValue(keyMap[mode], this.state[mode]);

            if (!this.state[mode]) {
                // Выключаем — восстанавливаем
                this._restoreMode(mode);
            }

            this._updateUI();
            this._managePoll();
            if (this.state[mode]) this._tick();
        }

        _resetAll() {
            ['spoof', 'blur', 'del'].forEach(m => {
                if (this.state[m]) this._restoreMode(m);
                this.state[m] = false;
            });
            GM_setValue(KEY_SPOOF_ON, false);
            GM_setValue(KEY_BLUR, false);
            GM_setValue(KEY_DEL, false);
            this._updateUI();
            this._managePoll();
        }

        _restoreMode(mode) {
            if (mode === 'spoof') {
                // Восстанавливаем оригинальный текст
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
                        n.style.pointerEvents = '';
                        // Восстанавливаем высоту
                        n.style.height = '';
                        n.style.overflow = '';
                        n.style.margin = '';
                        n.style.padding = '';
                    }
                });
                this._delNodes.clear();
                document.querySelectorAll('[data-ha-del]').forEach(n => {
                    delete n.dataset.haDel;
                });
            }
        }

        _updateUI() {
            const { btnSpoof, btnBlur, btnDel, spoofBlock } = this.el;
            btnSpoof.className = 'ha-btn' + (this.state.spoof ? ' on-spoof' : '');
            btnBlur.className  = 'ha-btn' + (this.state.blur  ? ' on-blur'  : '');
            btnDel.className   = 'ha-btn' + (this.state.del   ? ' on-del'   : '');
            spoofBlock.classList.toggle('visible', this.state.spoof);
            if (this.state.spoof && this.spoofAddress) {
                this._updateSpoofLabel(this.spoofAddress);
            }
        }

        _managePoll() {
            const anyOn = this.state.spoof || this.state.blur || this.state.del;
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
            // Порядок: сначала spoof (подменяем текст), потом blur, потом del
            if (this.state.spoof) this._applySpoof();
            if (this.state.blur)  this._applyBlur();
            if (this.state.del)   this._applyDel();
        }

        // MutationObserver — реагирует мгновенно на появление новых узлов адреса
        _startObserver() {
            this._observer = new MutationObserver(() => {
                if (this.state.spoof || this.state.blur || this.state.del) this._tick();
            });
            const startObs = () => {
                if (document.body) {
                    this._observer.observe(document.body, { childList: true, subtree: true });
                } else {
                    document.addEventListener('DOMContentLoaded', () => {
                        this._observer.observe(document.body, { childList: true, subtree: true });
                    });
                }
            };
            startObs();
        }

        _applySpoof() {
            if (!this.spoofAddress) {
                // Нет адреса — загружаем
                if (!this._spoofLoading) this._fetchSpoof();
                return;
            }
            const addr = this._stripCountryPrefix(this.spoofAddress);
            this._getAddressNodes().forEach(node => {
                if (!this._origTexts.has(node)) {
                    this._origTexts.set(node, node.textContent);
                }
                if (node.textContent !== addr) {
                    node.textContent = addr;
                }
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

        _applyDel() {
            // Скрываем контейнеры целиком через visibility+height=0
            // чтобы не оставалось пустых мест и оставаясь в DOM
            document.querySelectorAll(SEL_CONTAINER).forEach(container => {
                if (!container.dataset.haDel) {
                    container.dataset.haDel = '1';
                    container.style.visibility = 'hidden';
                    container.style.height = '0';
                    container.style.overflow = 'hidden';
                    container.style.margin = '0';
                    container.style.padding = '0';
                    container.style.pointerEvents = 'none';
                    this._delNodes.add(container);
                }
            });
        }

        _getAddressNodes() {
            return [...document.querySelectorAll(SEL_ADDR)];
        }

        _stripCountryPrefix(full) {
            // "Россия, г. Петропавловск-Камчатский, Радужная ул., д. 14 кв.65"
            // Ищем часть с улицей, начиная с третьего элемента (после "Россия, г. Город")
            const parts = full.split(',');
            if (parts.length >= 3) return parts.slice(2).join(',').trim();
            return full;
        }

        _fetchSpoof() {
            if (this._spoofLoading) return;
            this._spoofLoading = true;
            const btn = this.el.refresh;
            btn.disabled = true;
            this.el.spoofAddr.innerHTML = '<em>Загрузка...</em>';

            GM_xmlhttpRequest({
                method: 'GET',
                url: API_URL,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const raw = Array.isArray(data) ? data[0]?.Address : data?.Address;
                        if (!raw) throw new Error('no address');
                        // Сбрасываем spoof-метки чтобы _applySpoof обновил текст
                        this._origTexts.clear();
                        this.spoofAddress = raw;
                        GM_setValue(KEY_SPOOF, raw);
                        this._updateSpoofLabel(raw);
                        if (this.state.spoof) this._tick();
                    } catch {
                        this.el.spoofAddr.innerHTML = '<em>Ошибка загрузки</em>';
                    }
                    this._spoofLoading = false;
                    btn.disabled = false;
                },
                onerror: () => {
                    this.el.spoofAddr.innerHTML = '<em>Ошибка сети</em>';
                    this._spoofLoading = false;
                    btn.disabled = false;
                },
            });
        }

        _updateSpoofLabel(raw) {
            this.el.spoofAddr.textContent = this._stripCountryPrefix(raw);
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

    // document-start — ждём body
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
