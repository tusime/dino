/**
 * 成绩分享图
 * ------------------------------------------------------------------
 * 游戏结束后生成一张 1080×1350 的成绩卡（纯前端 Canvas，无依赖）：
 * 数字、恐龙、仙人掌全部取自游戏精灵图，保证与原版像素风格一致。
 * 支持下载 PNG，移动端支持系统分享面板（Web Share Level 2）。
 *
 * 与游戏本体的耦合只有三处：
 *   1. 包装 Runner.prototype.gameOver / restart，用来切 UI 状态
 *   2. 读 Runner.instance_ 的分数（distanceRan / highestScore）
 *   3. 读 Runner.spriteDefinition + 精灵图 <img>
 * 游戏逻辑一行未改。
 */
(function () {
    'use strict';

    var CARD_W = 1080;
    var CARD_H = 1350;

    var INK = '#535353';
    var MUTED = '#9a9a9a';
    var FAINT = '#c9c9c9';
    var BG = '#f7f7f7';
    var FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", ' +
        '-apple-system, "Segoe UI", sans-serif';

    var FALLBACK_URL = 'tusime.github.io/dino';

    var modal, modalImg, downloadBtn, shareBtn, closeBtn, shareButton;
    var currentBlob = null;
    var currentFileName = '';
    var lastFocus = null;
    var modalOpen = false;
    var listenersStopped = false;

    /** 暂停游戏的键盘/触摸监听，避免在弹层里操作时误触发跳跃或重开 */
    function stopGameInput() {
        var inst = window.Runner && Runner.instance_;
        if (!listenersStopped && inst && inst.stopListening) {
            inst.stopListening();
            listenersStopped = true;
        }
    }

    function startGameInput() {
        var inst = window.Runner && Runner.instance_;
        if (listenersStopped && inst && inst.startListening) {
            inst.startListening();
            listenersStopped = false;
        }
    }

    // ── 精灵图 ──────────────────────────────────────────────────────

    /**
     * 取精灵图与其坐标定义。优先 2x，保证成绩卡放大后依然锐利。
     * unit 表示精灵图内像素相对 1x 坐标系的倍率（字形 10×13、恐龙 44×47）。
     */
    function spriteSource() {
        var x2 = document.getElementById('offline-resources-2x');
        var x1 = document.getElementById('offline-resources-1x');
        var useHi = !!(x2 && x2.complete && x2.naturalWidth);
        var img = useHi ? x2 : x1;
        if (!img || !img.complete || !img.naturalWidth) {
            return null;
        }
        return {
            img: img,
            def: Runner.spriteDefinition[useHi ? 'HDPI' : 'LDPI'],
            unit: useHi ? 2 : 1
        };
    }

    /** 字形宽高比：10 × 13 */
    function glyphWidth(height) {
        return height * 10 / 13;
    }

    /**
     * 画一个精灵字形。
     * 序号 0-9 为数字，10 = H，11 = I（游戏里的最高分前缀就从这来）。
     */
    function drawGlyph(ctx, sp, index, x, top, height) {
        var sw = 10 * sp.unit;
        var sh = 13 * sp.unit;
        var sx = sp.def.TEXT_SPRITE.x + index * sw;
        var sy = sp.def.TEXT_SPRITE.y;
        var w = glyphWidth(height);
        ctx.drawImage(sp.img, sx, sy, sw, sh, x, top, w, height);
        return w;
    }

    /** 画一串数字，以 centerX 水平居中 */
    function drawNumber(ctx, sp, str, centerX, top, height, alpha) {
        var digits = String(str).split('');
        var w = glyphWidth(height);
        var gap = height * 0.08;
        var total = digits.length * w + (digits.length - 1) * gap;
        var x = centerX - total / 2;

        ctx.save();
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        for (var i = 0; i < digits.length; i++) {
            drawGlyph(ctx, sp, parseInt(digits[i], 10), x, top, height);
            x += w + gap;
        }
        ctx.restore();
    }

    /** 画 "HI 00000" 这一行，整体水平居中 */
    function drawHighScore(ctx, sp, best, centerX, top, height) {
        var w = glyphWidth(height);
        var gap = height * 0.08;
        var digits = String(best).split('');
        var hiW = 2 * w + gap;
        var digitW = digits.length * w + (digits.length - 1) * gap;
        var sep = height * 0.7;
        var x = centerX - (hiW + sep + digitW) / 2;

        ctx.save();
        ctx.globalAlpha = 0.45;
        drawGlyph(ctx, sp, 10, x, top, height);
        x += w + gap;
        drawGlyph(ctx, sp, 11, x, top, height);
        x += w + sep;
        for (var i = 0; i < digits.length; i++) {
            drawGlyph(ctx, sp, parseInt(digits[i], 10), x, top, height);
            x += w + gap;
        }
        ctx.restore();
    }

    /** 画一个精灵帧，height 为渲染高度，按原图比例算宽 */
    function drawFrame(ctx, sp, pos, sx, sy, sw, sh, x, top, height) {
        var w = height * sw / sh;
        ctx.drawImage(sp.img, pos.x + sx * sp.unit, pos.y + sy * sp.unit,
            sw * sp.unit, sh * sp.unit, x, top, w, height);
        return w;
    }

    /** 字距可控的文字（Canvas 的 letterSpacing 兼容性还不够，手写） */
    function drawSpacedText(ctx, text, x, y, size, color, spacing, align) {
        ctx.save();
        ctx.font = '500 ' + size + 'px ' + FONT;
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        var widths = [];
        var total = 0;
        for (var i = 0; i < text.length; i++) {
            var w = ctx.measureText(text[i]).width;
            widths.push(w);
            total += w + (i < text.length - 1 ? spacing : 0);
        }
        var offset = align === 'right' ? x - total : (align === 'center' ? x - total / 2 : x);
        for (var j = 0; j < text.length; j++) {
            ctx.fillText(text[j], offset, y);
            offset += widths[j] + spacing;
        }
        ctx.restore();
    }

    function formatDate(d) {
        var mm = ('0' + (d.getMonth() + 1)).slice(-2);
        var dd = ('0' + d.getDate()).slice(-2);
        return d.getFullYear() + '.' + mm + '.' + dd;
    }

    function siteLabel() {
        if (/^https?:$/.test(location.protocol) && location.hostname) {
            return location.hostname.replace(/^www\./, '') +
                (location.pathname.replace(/\/index\.html?$/, '').replace(/\/$/, '') || '');
        }
        return FALLBACK_URL;
    }

    // ── 卡片绘制 ────────────────────────────────────────────────────

    function buildCard(score, best) {
        var sp = spriteSource();
        var canvas = document.createElement('canvas');
        canvas.width = CARD_W;
        canvas.height = CARD_H;
        var ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, CARD_W, CARD_H);

        // 顶部标题行
        drawSpacedText(ctx, 'CHROME DINO', 80, 118, 26, MUTED, 5);
        drawSpacedText(ctx, formatDate(new Date()), CARD_W - 80, 118, 24, FAINT, 1, 'right');
        ctx.fillStyle = '#e2e2e2';
        ctx.fillRect(80, 152, CARD_W - 160, 2);

        // 主分数
        drawSpacedText(ctx, '本局得分', CARD_W / 2, 330, 30, MUTED, 4, 'center');
        var scoreTop = 380;
        var scoreHeight = 160;
        if (sp) {
            drawNumber(ctx, sp, score, CARD_W / 2, scoreTop, scoreHeight, 1);
            drawHighScore(ctx, sp, best, CARD_W / 2, scoreTop + scoreHeight + 46, 54);
        } else {
            // 精灵图未就绪时的兜底，正常路径不会走到
            ctx.fillStyle = INK;
            ctx.font = '600 140px ' + FONT;
            ctx.textAlign = 'center';
            ctx.fillText(String(score), CARD_W / 2, scoreTop + 140);
        }

        // 场景：地面 + 恐龙 + 仙人掌
        var groundY = 1030;
        drawGround(ctx, 80, CARD_W - 80, groundY);
        if (sp) {
            drawFrame(ctx, sp, sp.def.TREX, 0, 0, 44, 47, 170, groundY - 200, 200);
            drawFrame(ctx, sp, sp.def.CACTUS_SMALL, 0, 0, 17, 35, 600, groundY - 130, 130);
            drawFrame(ctx, sp, sp.def.CACTUS_LARGE, 0, 0, 25, 50, 690, groundY - 180, 180);
            drawFrame(ctx, sp, sp.def.CACTUS_SMALL, 0, 0, 17, 35, 805, groundY - 96, 96);
        }

        // 底部
        drawSpacedText(ctx, siteLabel(), CARD_W / 2, 1190, 28, MUTED, 1, 'center');
        drawSpacedText(ctx, '轻触屏幕跳跃，挑战我的纪录', CARD_W / 2, 1244, 24, FAINT, 2, 'center');

        return canvas;
    }

    /** 地面线：1px 主线 + 随机小石子，模仿游戏里的地平线 */
    function drawGround(ctx, x1, x2, y) {
        ctx.save();
        ctx.fillStyle = '#c4c4c4';
        ctx.fillRect(x1, y, x2 - x1, 2);
        ctx.fillStyle = '#dcdcdc';
        var seed = 7;
        for (var x = x1 + 10; x < x2 - 10; x += 24) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            var r = seed / 2147483648;
            var h = 2 + Math.floor(r * 3);
            ctx.fillRect(x + Math.floor(r * 8), y + 6 + Math.floor(r * 4), 6, h);
        }
        ctx.restore();
    }

    // ── 分数读取 ────────────────────────────────────────────────────

    function readScores() {
        var inst = Runner.instance_;
        if (!inst || !inst.distanceMeter) {
            return { score: 0, best: 0 };
        }
        var meter = inst.distanceMeter;
        var raw = Math.ceil(inst.distanceRan || 0);
        var score = meter.getActualDistance(raw);
        var best = meter.getActualDistance(Math.max(raw, inst.highestScore || 0));
        return { score: score, best: Math.max(best, score) };
    }

    // ── 导出与分享 ──────────────────────────────────────────────────

    function canvasToBlob(canvas) {
        return new Promise(function (resolve, reject) {
            if (canvas.toBlob) {
                canvas.toBlob(function (blob) {
                    blob ? resolve(blob) : reject(new Error('toBlob failed'));
                }, 'image/png');
            } else {
                reject(new Error('canvas.toBlob unsupported'));
            }
        });
    }

    function fileNameFor(score) {
        return 'dino-score-' + score + '.png';
    }

    function download() {
        if (!currentBlob) {
            return;
        }
        var url = URL.createObjectURL(currentBlob);
        var a = document.createElement('a');
        a.href = url;
        a.download = currentFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 4000);
    }

    function share() {
        if (!currentBlob || !navigator.canShare) {
            return;
        }
        var file = new File([currentBlob], currentFileName, { type: 'image/png' });
        if (!navigator.canShare({ files: [file] })) {
            return;
        }
        navigator.share({
            files: [file],
            title: 'CHROME DINO',
            text: '我在 CHROME DINO 跑出了 ' + currentScoreForText + ' 分，来挑战！'
        }).catch(function () {
            /* 用户取消或环境不支持，静默处理 */
        });
    }

    var currentScoreForText = 0;

    // ── UI 状态 ────────────────────────────────────────────────────

    function openModal(canvas, score) {
        return canvasToBlob(canvas).then(function (blob) {
            currentBlob = blob;
            currentFileName = fileNameFor(score);
            currentScoreForText = score;

            var url = URL.createObjectURL(blob);
            modalImg.src = url;
            shareBtn.hidden = !(navigator.canShare && navigator.canShare({
                files: [new File([blob], currentFileName, { type: 'image/png' })]
            }));

            lastFocus = document.activeElement;
            modal.hidden = false;
            modalOpen = true;
            document.body.classList.add('dino-modal-open');
            stopGameInput();
            // 焦点放在弹层本身而不是按钮上：否则空格会"激活"关闭按钮，
            // 一按空格预览就被关掉。放在容器上则空格不会误触任何控件。
            modal.focus();
        });
    }

    function closeModal() {
        if (!modalOpen) {
            return;
        }
        modalOpen = false;
        modal.hidden = true;
        document.body.classList.remove('dino-modal-open');
        if (modalImg.src) {
            URL.revokeObjectURL(modalImg.src);
            modalImg.removeAttribute('src');
        }
        currentBlob = null;
        startGameInput();
        if (lastFocus && lastFocus.focus && lastFocus.offsetParent !== null) {
            lastFocus.focus();
        }
    }

    function onShareClick() {
        var scores = readScores();
        var canvas = buildCard(scores.score, scores.best);
        openModal(canvas, scores.score).catch(function (err) {
            console.error('[share] 生成成绩图失败', err);
        });
    }

    function onGameOver() {
        document.body.classList.add('dino-crashed');
    }

    function onRestart() {
        document.body.classList.remove('dino-crashed');
        closeModal();
    }

    // 兜底：游戏的监听若被重新挂上（例如切回标签页后），拦下按键，
    // 但保留弹层内按钮用键盘激活的能力
    function blockGameKeys(e) {
        if (!modalOpen) {
            return;
        }
        var t = e.target;
        if (modal && t && t.tagName === 'BUTTON' && modal.contains(t)) {
            return;
        }
        e.stopPropagation();
        if (e.keyCode === 32) {
            e.preventDefault();
        }
    }

    function init() {
        shareButton = document.getElementById('share-button');
        modal = document.getElementById('score-modal');
        modalImg = document.getElementById('score-modal-img');
        downloadBtn = document.getElementById('score-download');
        shareBtn = document.getElementById('score-share');
        closeBtn = document.getElementById('score-close');

        if (!shareButton || !modal) {
            return;
        }

        shareButton.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            onShareClick();
        });

        downloadBtn.addEventListener('click', download);
        shareBtn.addEventListener('click', share);
        closeBtn.addEventListener('click', closeModal);

        // 点遮罩关闭（卡片内部不触发）
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (modalOpen && (e.key === 'Escape' || e.keyCode === 27)) {
                e.stopPropagation();
                e.preventDefault();
                closeModal();
            }
        }, true);

        ['keydown', 'keyup'].forEach(function (type) {
            document.addEventListener(type, blockGameKeys, true);
        });

        // 包装游戏结束/重开，切换分享入口的显隐
        if (window.Runner && Runner.prototype && Runner.prototype.gameOver) {
            var origGameOver = Runner.prototype.gameOver;
            Runner.prototype.gameOver = function () {
                var ret = origGameOver.apply(this, arguments);
                onGameOver();
                return ret;
            };

            var origRestart = Runner.prototype.restart;
            Runner.prototype.restart = function () {
                var ret = origRestart.apply(this, arguments);
                if (!this.crashed) {
                    onRestart();
                }
                return ret;
            };
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
