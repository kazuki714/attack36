/* アタック25：平成モードのタイトル画面を three.js で描く。
 * index.html から Title3D.start(opts) / update(opts) / stop() で呼ぶ。
 * 描くもの：メッキの立体ロゴ（1文字ずつ飛んでくる）、裏返るパネルの壁（ときどきハート）、
 * 周回する平成グッズ、集中線、星、紙吹雪とハート、光のにじみとレンズフレア。 */
(() => {
  const T = window.THREE;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outBack: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  };
  const FONT = '"HG創英角ポップ体", "HGSoeiKakupoptai", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
  const srgb = hex => new T.Color(hex); // Color は sRGB の 16 進数を線形に直して持つ

  // ---- 全画面の四角（背景と後処理で使う） ----
  const FS_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  function fsQuad(material) {
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), material);
    m.frustumCulled = false;
    return m;
  }

  // ---- 映り込み用の環境：紫の空に、白・ピンク・水色・黄色の照明板を浮かべる ----
  function makeEnvironment(renderer) {
    const env = new T.Scene();
    const sky = new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.ShaderMaterial({
      side: T.BackSide,
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main() {
          float y = normalize(vP).y;
          vec3 c = mix(vec3(0.02, 0.0, 0.10), vec3(0.55, 0.08, 0.35), smoothstep(-0.6, 0.0, y));
          c = mix(c, vec3(0.05, 0.12, 0.6), smoothstep(0.0, 0.8, y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    env.add(sky);
    const panel = (color, power, w, hgt, pos) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, hgt), new T.MeshBasicMaterial({ color: srgb(color).multiplyScalar(power), side: T.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel('#ffffff', 3.2, 30, 6, [0, 22, 10]);   // 上の大きな白い板（ロゴの上辺がギラッと光る）
    panel('#ffffff', 2, 8, 26, [-24, 4, 8]);
    panel('#ff4fb8', 2.5, 10, 18, [24, 2, 6]);
    panel('#3ce8ff', 2.5, 18, 6, [-6, -14, 18]);
    panel('#ffe94a', 3, 6, 6, [14, 16, -12]);
    panel('#9b5bff', 2, 20, 8, [0, 6, -26]);
    const pmrem = new T.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(env, 0.02);
    pmrem.dispose();
    env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return rt;
  }

  // ---- 背景：回る集中線と、中央の光 ----
  function makeBackground() {
    const mat = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uPulse: { value: 0 } },
      vertexShader: FS_VERT,
      fragmentShader: `varying vec2 vUv; uniform float uTime, uAspect, uPulse;
        vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
        void main() {
          vec2 p = (vUv - vec2(0.5, 0.58)) * vec2(uAspect, 1.0);
          float r = length(p), a = atan(p.y, p.x);
          float f = fract(a / 6.2831853 * 24.0 + uTime * 0.015);
          float w = fwidth(f) * 1.5;
          float ray = smoothstep(0.5 - w, 0.5 + w, f) * (1.0 - smoothstep(1.0 - w, 1.0, f));
          vec3 col = mix(lin(vec3(0.10, 0.03, 0.42)), lin(vec3(0.20, 0.07, 0.62)), ray);
          col += lin(vec3(1.0, 0.45, 0.85)) * (0.55 + 0.35 * uPulse) * exp(-r * 2.6);
          col += lin(vec3(1.0, 0.95, 0.7)) * 0.35 * exp(-r * 9.0);
          col *= 1.0 - 0.55 * smoothstep(0.35, 1.25, r);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = fsQuad(mat);
    m.renderOrder = -1000;
    return m;
  }

  // ---- 星（4本の光芒つき。ゆっくり瞬く） ----
  const STAR_FRAG = `varying vec3 vColor; varying float vTw;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = length(p);
      float core = exp(-d * d * 18.0);
      float spikes = exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 2.6) + exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 2.6);
      float a = (core + spikes * 0.8) * vTw;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor * a, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  function makeStars(count) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count), size = new Float32Array(count);
    const palette = ['#ffffff', '#fff3a0', '#ff9df2', '#9df4ff', '#ffffff'].map(srgb);
    for (let i = 0; i < count; i++) {
      const r = 30 + Math.random() * 60, th = Math.random() * TAU, ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.8, -Math.abs(r * Math.sin(ph) * Math.sin(th)) - 8], i * 3);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = Math.random() * 100;
      size[i] = Math.random() < 0.08 ? 3.2 : 0.8 + Math.random() * 1.2;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setAttribute('seed', new T.BufferAttribute(seed, 1));
    g.setAttribute('size', new T.BufferAttribute(size, 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uWarp: { value: 0 } },
      vertexShader: `attribute vec3 color; attribute float seed, size; uniform float uTime, uScale, uWarp;
        varying vec3 vColor; varying float vTw;
        void main() {
          vec3 p = position;
          p.z = mod(p.z + uWarp * 2.0 + 100.0, 100.0) - 100.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vTw = 0.55 + 0.45 * sin(uTime * (1.5 + fract(seed) * 2.5) + seed);
          vColor = color * 2.2;
          gl_PointSize = size * uScale * (1.0 + uWarp * 0.6) * 22.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: STAR_FRAG,
    });
    return new T.Points(g, mat);
  }

  // ---- 文字の輪郭を取る：canvas に描いた文字を、マーチングスクエア法で多角形にする ----
  // 返す loops は canvas の画素座標（y は下向き）。外側と穴は後で入れ子の深さで見分ける
  function traceChar(ch, px) {
    const font = `900 ${px}px ${FONT}`;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    const adv = probe.measureText(ch).width;
    const pad = Math.ceil(px * 0.2), base = Math.ceil(px * 1.05);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(adv + pad * 2);
    cv.height = Math.ceil(px * 1.4);
    const ctx = cv.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.lineWidth = px * 0.09; // 少し太らせて丸みのあるポップ体らしい形にする
    ctx.fillText(ch, pad, base);
    ctx.strokeText(ch, pad, base);
    const W = cv.width, H = cv.height, data = ctx.getImageData(0, 0, W, H).data;
    const v = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) v[i] = data[i * 4 + 3] / 255;

    const TH = 0.5, pos = new Map(), adj = new Map();
    const edge = (key, x, y) => { if (!pos.has(key)) pos.set(key, [x, y]); return key; };
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    };
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const tl = v[y * W + x], tr = v[y * W + x + 1], br = v[(y + 1) * W + x + 1], bl = v[(y + 1) * W + x];
      const c = (tl > TH) << 3 | (tr > TH) << 2 | (br > TH) << 1 | (bl > TH);
      if (c === 0 || c === 15) continue;
      const E = {
        get T() { return edge((y * W + x) * 2, x + (TH - tl) / (tr - tl), y); },
        get R() { return edge((y * W + x + 1) * 2 + 1, x + 1, y + (TH - tr) / (br - tr)); },
        get B() { return edge(((y + 1) * W + x) * 2, x + (TH - bl) / (br - bl), y + 1); },
        get L() { return edge((y * W + x) * 2 + 1, x, y + (TH - tl) / (bl - tl)); },
      };
      const mid = (tl + tr + br + bl) / 4 > TH;
      switch (c) {
        case 1: case 14: link(E.L, E.B); break;
        case 2: case 13: link(E.B, E.R); break;
        case 3: case 12: link(E.L, E.R); break;
        case 4: case 11: link(E.T, E.R); break;
        case 6: case 9: link(E.T, E.B); break;
        case 7: case 8: link(E.T, E.L); break;
        case 5: if (mid) { link(E.T, E.L); link(E.B, E.R); } else { link(E.T, E.R); link(E.L, E.B); } break;
        case 10: if (mid) { link(E.T, E.R); link(E.L, E.B); } else { link(E.T, E.L); link(E.B, E.R); } break;
      }
    }
    const loops = [], seen = new Set();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let prev = -1, cur = start;
      while (!seen.has(cur)) {
        seen.add(cur);
        loop.push(pos.get(cur));
        const [a, b] = adj.get(cur);
        const next = a !== prev ? a : b;
        prev = cur; cur = next;
      }
      if (loop.length > 8) loops.push(simplifyLoop(loop, 0.35));
    }
    return { loops, adv, pad, base };
  }

  // 閉じた折れ線を Ramer–Douglas–Peucker 法で間引く
  function simplifyLoop(pts, eps) {
    let far = 0, best = -1;
    pts.forEach((p, i) => { const d = (p[0] - pts[0][0]) ** 2 + (p[1] - pts[0][1]) ** 2; if (d > best) { best = d; far = i; } });
    const rdp = chain => {
      if (chain.length < 3) return chain;
      const [ax, ay] = chain[0], [bx, by] = chain[chain.length - 1];
      const len = Math.hypot(bx - ax, by - ay) || 1e-9;
      let idx = 0, dmax = 0;
      for (let i = 1; i < chain.length - 1; i++) {
        const d = Math.abs((bx - ax) * (ay - chain[i][1]) - (ax - chain[i][0]) * (by - ay)) / len;
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax <= eps) return [chain[0], chain[chain.length - 1]];
      return rdp(chain.slice(0, idx + 1)).slice(0, -1).concat(rdp(chain.slice(idx)));
    };
    const a = rdp(pts.slice(0, far + 1)), b = rdp(pts.slice(far).concat([pts[0]]));
    return a.slice(0, -1).concat(b.slice(0, -1));
  }

  const signedArea = pts => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y); return s / 2; };
  function inside(pt, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  // 輪郭を three.js の Shape（穴つき）にする。入れ子の深さが偶数なら外側、奇数なら穴
  function toShapes(loops, toWorld) {
    const polys = loops.map(l => l.map(([x, y]) => toWorld(x, y))).filter(p => Math.abs(signedArea(p)) > 1e-4);
    const depth = polys.map((p, i) => polys.filter((q, j) => j !== i && inside(p[0], q)).length);
    const shapes = [];
    polys.forEach((p, i) => {
      if (depth[i] % 2) return;
      if (!T.ShapeUtils.isClockWise(p)) p.reverse();
      const shape = new T.Shape(p);
      polys.forEach((hp, k) => {
        if (depth[k] !== depth[i] + 1 || !inside(hp[0], p)) return;
        if (T.ShapeUtils.isClockWise(hp)) hp.reverse();
        shape.holes.push(new T.Path(hp));
      });
      shapes.push(shape);
    });
    return shapes;
  }

  function gradientTexture(colors, gloss) {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    if (gloss) { // 上半分にツヤの帯
      const s = ctx.createLinearGradient(0, 20, 0, 110);
      s.addColorStop(0, 'rgba(255,255,255,.55)'); s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 20, 4, 90);
    }
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  // ---- 立体ロゴ：「アタック」は黄色〜ピンク、「25」は水色〜紫の面。側面は虹色に光るメッキ、後ろに濃い紫のフチ ----
  function makeLogoMaterials() {
    const face = colors => { const map = gradientTexture(colors, true); return new T.MeshPhysicalMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.35, envMapIntensity: 0.4, metalness: 0, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.08 }); };
    return {
      face: face(['#fff27a', '#ffd000', '#ff8a00', '#ff2d6f']),
      faceNum: face(['#e8ffff', '#4fe3ff', '#2f6bff', '#9b3dff']),
      side: new T.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 0.15, iridescence: 1, iridescenceIOR: 1.4, iridescenceThicknessRange: [150, 750], envMapIntensity: 1 }),
      rim: new T.MeshPhysicalMaterial({ color: '#2b0057', metalness: 0.4, roughness: 0.35, clearcoat: 1 }),
    };
  }
  // 面のグラデーションは文字の高さ方向に貼る（v = 0 が下端、1 が上端）
  function setGradientUV(geo, y0, y1) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5, clamp((p.getY(i) - y0) / (y1 - y0), 0, 1));
  }
  // キラッと光らせる場所の候補：手前を向いた面取りの頂点
  function sampleGlints(geo) {
    const p = geo.attributes.position, n = geo.attributes.normal, out = [];
    for (let k = 0; k < 400 && out.length < 40; k++) {
      const i = Math.floor(Math.random() * p.count);
      if (n.getZ(i) > 0.3 && n.getZ(i) < 0.95) out.push(new T.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    }
    return out;
  }
  function makeLogo(text, mats) {
    const m = /^(.*?)(\d+)$/.exec(text) || [text, text, ''];
    const parts = [...m[1]].map(ch => ({ ch, px: 150, num: false })).concat([...m[2]].map(ch => ({ ch, px: 190, num: true })));
    const S = 1 / 95; // 1 画素 → 世界座標
    const group = new T.Group(), letters = [];
    let cursor = 0;
    for (const p of parts) {
      const tr = traceChar(p.ch, p.px);
      const shapes = toShapes(tr.loops, (x, y) => new T.Vector2((x - tr.pad) * S, (tr.base - y) * S));
      if (shapes.length) {
        const geo = new T.ExtrudeGeometry(shapes, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.05, bevelSegments: 3, curveSegments: 1 });
        const back = new T.ExtrudeGeometry(shapes, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelOffset: 0.08, bevelSegments: 2, curveSegments: 1 });
        setGradientUV(geo, -0.17 * p.px * S, 0.93 * p.px * S);
        geo.computeBoundingBox();
        const c = geo.boundingBox.getCenter(new T.Vector3());
        geo.translate(-c.x, -c.y, -c.z);
        back.translate(-c.x, -c.y, -c.z - 0.3);
        const pivot = new T.Group();
        pivot.add(new T.Mesh(back, mats.rim), new T.Mesh(geo, [p.num ? mats.faceNum : mats.face, mats.side]));
        pivot.userData = { home: new T.Vector3(cursor + c.x, c.y, 0), glints: sampleGlints(geo), num: p.num };
        group.add(pivot);
        letters.push(pivot);
      }
      cursor += tr.adv * S * 0.9;
    }
    letters.forEach(l => { l.userData.home.x -= cursor / 2; l.position.copy(l.userData.home); });
    return { group, letters, width: cursor };
  }

  // 「ATTACK 25」の虹色の文字（板に貼る）
  function makeSubLogo() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.font = '900 84px "Arial Black", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '22px';
    const g = ctx.createLinearGradient(160, 0, 864, 0);
    ['#ff004c', '#ff9a00', '#ffee00', '#2bff5a', '#00c8ff', '#b45bff'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2b0057';
    ctx.strokeText('ATTACK 25', 512, 66);
    ctx.fillStyle = g;
    ctx.fillText('ATTACK 25', 512, 66);
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return new T.Mesh(new T.PlaneGeometry(6.4, 0.8), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  // ロゴの後ろで回る虹色の輪
  const HUE = 'vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }';
  function makeHalo() {
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { uTime: { value: 0 }, uBoost: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uTime, uBoost; ${HUE}
        void main() {
          float r = length(vP), a = atan(vP.y, vP.x) / 6.2831853 + uTime * 0.04;
          float band = smoothstep(3.8, 4.5, r) * (1.0 - smoothstep(4.5, 6.4, r));
          float spokes = 0.55 + 0.45 * sin(a * 6.2831853 * 14.0 + uTime * 1.5);
          gl_FragColor = vec4(pow(hue(fract(a)), vec3(2.2)) * band * spokes * (0.45 + uBoost), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return new T.Mesh(new T.RingGeometry(3.8, 6.4, 160, 1), mat);
  }

  // 着地の衝撃波
  function makeShockwave() {
    const m = new T.Mesh(new T.RingGeometry(0.92, 1, 128, 1), new T.MeshBasicMaterial({ color: srgb('#fff4c2').multiplyScalar(3), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    m.visible = false;
    return m;
  }

  // ロゴの上でキラッと光る星（数個を使い回す）
  function makeGlints(count) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('size', new T.BufferAttribute(new Float32Array(count), 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float size; uniform float uScale; varying vec3 vColor; varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vColor = vec3(3.0, 2.8, 2.2); vTw = 1.0;
          gl_PointSize = size * uScale * 60.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: STAR_FRAG,
    });
    const pts = new T.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.userData.slots = Array.from({ length: count }, () => ({ t: -Math.random() * 2, life: 0.7, letter: null, at: null }));
    return pts;
  }

  // ---- 裏返るパネルの壁（ロゴの後ろ）。ときどき 25 枚でハートを描く ----
  const HEART = [0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  function roundedRect(w, hgt, r) {
    const s = new T.Shape(), x = -w / 2, y = -hgt / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + hgt - r); s.quadraticCurveTo(x + w, y + hgt, x + w - r, y + hgt);
    s.lineTo(x + r, y + hgt); s.quadraticCurveTo(x, y + hgt, x, y + hgt - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function canvasTexture(w, hgt, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    draw(cv.getContext('2d'), w, hgt);
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }
  // パネルの表（番号）と、色パネル用のツヤ（色はマテリアルの color で付ける）
  const panelFace = (ctx, w, hgt, dark) => {
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    (dark ? ['#3a2a8a', '#24145e', '#160a3c'] : ['#ffffff', '#e6e0ff', '#b9b0e6']).forEach((c, k) => g.addColorStop(k / 2, c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, hgt);
    const s = ctx.createLinearGradient(0, 0, 0, hgt * 0.45);
    s.addColorStop(0, dark ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.9)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = s; ctx.fillRect(w * 0.06, hgt * 0.05, w * 0.88, hgt * 0.4);
  };
  function makeBoard() {
    const body = new T.ExtrudeGeometry(roundedRect(1, 1, 0.14), { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 });
    body.translate(0, 0, -0.07);
    const bodyMat = new T.MeshPhysicalMaterial({ color: '#9a90d0', metalness: 0.3, roughness: 0.25, clearcoat: 1 });
    const face = new T.PlaneGeometry(0.92, 0.92);
    const gloss = canvasTexture(128, 128, panelFace);
    const numbers = Array.from({ length: 25 }, (_, i) => canvasTexture(128, 128, (ctx, w, hgt) => {
      panelFace(ctx, w, hgt, true);
      ctx.font = `900 72px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c9bcff';
      ctx.fillText(String(i + 1), w / 2, hgt / 2 + 4);
    }));
    const group = new T.Group(), tiles = [];
    for (let i = 0; i < 25; i++) {
      const faces = [0, 1].map(k => {
        const m = new T.Mesh(face, new T.MeshPhysicalMaterial({ map: numbers[i], roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 }));
        m.position.z = k ? -0.115 : 0.115;
        if (k) m.rotation.y = Math.PI;
        return m;
      });
      const pivot = new T.Group();
      pivot.add(new T.Mesh(body, bodyMat), ...faces);
      pivot.position.set((i % 5 - 2) * 1.12, (2 - Math.floor(i / 5)) * 1.12, 0);
      pivot.userData = { i, faces, side: 0, look: -1, from: 0, to: 0, t0: -9, dur: 0.6 };
      group.add(pivot);
      tiles.push(pivot);
    }
    return { group, tiles, numbers, gloss };
  }

  // ---- 周回する平成グッズ（index.html の絵・ステッカー・写真を板に描く） ----
  function svgImage(svg) {
    const vb = /viewBox="([\d.\s-]+)"/.exec(svg)[1].split(/\s+/).map(Number);
    const sized = svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${vb[2] * 4}" height="${vb[3] * 4}" `);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
    });
  }
  const BURST = [50, 0, 61, 16, 79, 9, 79, 28, 98, 30, 87, 46, 100, 61, 82, 68, 86, 88, 67, 83, 56, 100, 44, 85, 26, 94, 22, 75, 2, 70, 13, 54, 0, 38, 19, 32, 17, 12, 36, 17];
  function stickerCanvas(logo) {
    const probe = document.createElement('canvas').getContext('2d');
    const font = `900 64px ${FONT}`;
    probe.font = font;
    const tw = probe.measureText(logo.t).width;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (logo.burst) {
      cv.width = cv.height = Math.ceil(tw * 1.9);
      const s = cv.width / 100;
      ctx.beginPath();
      for (let k = 0; k < BURST.length; k += 2) ctx.lineTo(BURST[k] * s, BURST[k + 1] * s);
      ctx.closePath();
      ctx.fillStyle = logo.bg; ctx.fill();
    } else {
      cv.width = Math.ceil(tw + 90); cv.height = 124;
      const r = 50;
      ctx.beginPath();
      ctx.roundRect(12, 12, cv.width - 24, cv.height - 24, r);
      ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
      ctx.lineWidth = 12; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = logo.bg; ctx.fill();
    }
    ctx.font = font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = logo.fg;
    ctx.fillText(logo.t, cv.width / 2, cv.height / 2 + 3);
    return cv;
  }
  const PHOTO_CAPTIONS = ['LOVE♡', 'ずっと一緒☆', '平成ﾌｫｰｴﾊﾞｰ', '仲良し♪'];
  function photoCanvas(img, i) {
    const cv = document.createElement('canvas');
    cv.width = 300; cv.height = 350;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 350);
    ctx.setLineDash([10, 9]); ctx.lineWidth = 8; ctx.strokeStyle = '#ff6fb5';
    ctx.strokeRect(6, 6, 288, 338);
    ctx.drawImage(img, 22, 22, 256, 256);
    ctx.font = `900 34px ${FONT}`;
    ctx.textAlign = 'center'; ctx.fillStyle = '#ff3d9a';
    ctx.fillText(PHOTO_CAPTIONS[i % PHOTO_CAPTIONS.length], 150, 322);
    return cv;
  }
  const loadImage = src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
  // 中身（キャンバス）が揃ったものから板にして返す
  async function goodsCanvases(opts) {
    const arts = await Promise.all(Object.values(opts.art).map(svgImage));
    const out = [];
    arts.forEach((img, k) => {
      if (!img) return;
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      out.push({ cv, size: 1.5 });
      if (opts.logos[k]) out.push({ cv: stickerCanvas(opts.logos[k]), size: 0.9 });
    });
    const photos = await Promise.all((opts.photos || []).map(loadImage));
    photos.forEach((img, i) => { if (img) out.splice(1 + i * 3, 0, { cv: photoCanvas(img, i), size: 2.0 }); });
    return out;
  }

  // ---- 降ってくる紙吹雪と、ぷっくりしたハート ----
  const rand = (a, b) => a + Math.random() * (b - a);
  function heartShape() {
    const s = new T.Shape();
    s.moveTo(0, 0.25);
    s.bezierCurveTo(0, 0.45, -0.5, 0.5, -0.5, 0.15);
    s.bezierCurveTo(-0.5, -0.15, -0.15, -0.3, 0, -0.5);
    s.bezierCurveTo(0.15, -0.3, 0.5, -0.15, 0.5, 0.15);
    s.bezierCurveTo(0.5, 0.5, 0, 0.45, 0, 0.25);
    return s;
  }
  function makeFalling(geometry, material, count, colors, speed) {
    const mesh = new T.InstancedMesh(geometry, material, count);
    const c = new T.Color();
    mesh.userData.parts = Array.from({ length: count }, (_, i) => {
      mesh.setColorAt(i, c.set(colors[i % colors.length]));
      return { p: new T.Vector3(rand(-15, 15), rand(-10, 12), rand(-7, 5)), v: rand(speed[0], speed[1]), sway: rand(0, TAU), spin: new T.Vector3(rand(-3, 3), rand(-3, 3), rand(-2, 2)), r: new T.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)) };
    });
    mesh.frustumCulled = false;
    return mesh;
  }
  const dummy = new T.Object3D();
  function updateFalling(mesh, dt, t) {
    mesh.userData.parts.forEach((q, i) => {
      q.p.y -= q.v * dt;
      q.p.x += Math.sin(t * 1.3 + q.sway) * 0.5 * dt;
      q.r.x += q.spin.x * dt; q.r.y += q.spin.y * dt; q.r.z += q.spin.z * dt;
      if (q.p.y < -10) { q.p.y = 12; q.p.x = rand(-15, 15); }
      dummy.position.copy(q.p);
      dummy.rotation.copy(q.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 後処理：光のにじみ（明るいところだけ取り出してぼかす）、レンズフレア、白い閃光 ----
  function makePost(renderer) {
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = fsQuad(null);
    const shader = (fragmentShader, uniforms) => new T.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    const bright = shader(`varying vec2 vUv; uniform sampler2D tDiffuse;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(1.0, 2.2, l), 1.0);
      }`, { tDiffuse: { value: null } });
    const blur = shader(`varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uDir;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
        c += (texture2D(tDiffuse, vUv + uDir * 1.385).rgb + texture2D(tDiffuse, vUv - uDir * 1.385).rgb) * 0.316;
        c += (texture2D(tDiffuse, vUv + uDir * 3.231).rgb + texture2D(tDiffuse, vUv - uDir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(c, 1.0);
      }`, { tDiffuse: { value: null }, uDir: { value: new T.Vector2() } });
    const composite = shader(`varying vec2 vUv;
      uniform sampler2D tScene, tBloom1, tBloom2;
      uniform float uBloom, uFlash, uFlare, uAspect;
      uniform vec2 uFlarePos;
      ${HUE}
      vec3 flare(vec2 uv) {
        vec2 d = (uv - uFlarePos) * vec2(uAspect, 1.0);
        float r = length(d);
        vec3 c = vec3(1.0, 0.85, 0.6) * exp(-r * 7.0) * 1.4;
        c += vec3(0.55, 0.75, 1.0) * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 1.8) * 1.6;
        c += vec3(1.0, 0.9, 0.8) * pow(max(0.0, cos(atan(d.y, d.x) * 6.0)), 16.0) * exp(-r * 4.0);
        vec2 axis = vec2(0.5) - uFlarePos;
        for (int k = 0; k < 5; k++) {
          float f = float(k);
          vec2 gp = uFlarePos + axis * (0.6 + f * 0.36);
          float rad = 0.025 + 0.022 * f;
          float dist = length((uv - gp) * vec2(uAspect, 1.0));
          c += pow(hue(fract(0.12 + f * 0.19)), vec3(2.2)) * smoothstep(rad, rad * 0.55, dist) * 0.22;
        }
        return c * uFlare;
      }
      void main() {
        vec2 off = (vUv - 0.5) * 0.003;
        vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
        col += (texture2D(tBloom1, vUv).rgb * 0.5 + texture2D(tBloom2, vUv).rgb * 0.8) * uBloom;
        col += flare(vUv);
        col = mix(col, vec3(4.0), uFlash);
        col *= 1.0 - 0.35 * smoothstep(0.45, 1.1, length((vUv - 0.5) * vec2(uAspect, 1.0)));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`, {
      tScene: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      uBloom: { value: 1 }, uFlash: { value: 0 }, uFlare: { value: 0 }, uAspect: { value: 1 }, uFlarePos: { value: new T.Vector2(0.5, 0.5) },
    });
    const target = (samples, depth) => new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples, depthBuffer: depth });
    const rt = { scene: target(4, true), a: target(0, false), b: target(0, false), c: target(0, false), d: target(0, false) };
    const pass = (mat, to) => { quad.material = mat; renderer.setRenderTarget(to); renderer.render(quad, cam); };
    return {
      uniforms: composite.uniforms,
      setSize(w, hgt) {
        rt.scene.setSize(w, hgt);
        rt.a.setSize(w >> 1, hgt >> 1); rt.b.setSize(w >> 1, hgt >> 1);
        rt.c.setSize(w >> 2, hgt >> 2); rt.d.setSize(w >> 2, hgt >> 2);
        composite.uniforms.uAspect.value = w / hgt;
      },
      render(scene, camera) {
        renderer.setRenderTarget(rt.scene);
        renderer.render(scene, camera);
        bright.uniforms.tDiffuse.value = rt.scene.texture; pass(bright, rt.a);
        const step = (from, to, dx, dy) => { blur.uniforms.tDiffuse.value = from.texture; blur.uniforms.uDir.value.set(dx / to.width, dy / to.height); pass(blur, to); };
        step(rt.a, rt.b, 1, 0); step(rt.b, rt.a, 0, 1);
        step(rt.a, rt.c, 1, 0); step(rt.c, rt.d, 0, 1);
        step(rt.d, rt.c, 2, 0); step(rt.c, rt.d, 0, 2);
        composite.uniforms.tScene.value = rt.scene.texture;
        composite.uniforms.tBloom1.value = rt.a.texture;
        composite.uniforms.tBloom2.value = rt.d.texture;
        pass(composite, null);
      },
      dispose() {
        Object.values(rt).forEach(r => r.dispose());
        [bright, blur, composite].forEach(m => m.dispose());
        quad.geometry.dispose();
      },
    };
  }

  // ---- 場面を組み立てる ----
  let renderer = null, canvas = null, world = null;
  const CONFETTI = ['#E53935', '#1E5FD6', '#2E9E44', '#E8B400', '#F57C00', '#8E44AD', '#ffffff', '#ffe94a', '#ff9df2', '#9df4ff'];

  function buildWorld(opts) {
    const w = { opts, lite: !!opts.lite, t0: performance.now(), last: performance.now(), quality: 1, perf: { sum: 0, n: 0, at: 4 } };
    const scene = w.scene = new T.Scene();
    scene.fog = new T.Fog(srgb('#14004f'), 18, 52);
    w.envRT = makeEnvironment(renderer);
    scene.environment = w.envRT.texture;
    w.camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
    scene.add(w.bg = makeBackground());
    scene.add(w.stars = makeStars(w.lite ? 700 : 1600));
    scene.add(new T.AmbientLight(0xffffff, 0.3));
    const key = new T.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 8);
    scene.add(key);
    scene.add(w.sweep = new T.PointLight(srgb('#fff2d0'), 0, 30, 1.5));

    // ロゴ（中心が logoRoot の原点に来るようにずらす）
    w.logoRoot = new T.Group();
    w.logoRoot.position.set(0, 1.45, 0);
    w.logoRoot.scale.setScalar(LOGO_SCALE);
    scene.add(w.logoRoot);
    w.logoMats = makeLogoMaterials();
    w.logo = makeLogo(opts.title || 'アタック25', w.logoMats);
    w.logo.group.position.y = -0.65;
    w.logo.letters.forEach(l => { l.visible = false; });
    w.logoRoot.add(w.logo.group);
    w.sub = makeSubLogo();
    w.sub.position.set(0, -1.55, 0.3);
    w.sub.material.opacity = 0;
    w.logoRoot.add(w.sub);
    w.halo = makeHalo();
    w.halo.position.z = -1.8;
    w.halo.scale.set(1.3, 0.6, 1);
    w.logoRoot.add(w.halo);
    w.shock = makeShockwave();
    w.shock.position.z = -0.6;
    w.logoRoot.add(w.shock);
    scene.add(w.glints = makeGlints(8));

    // パネルの壁
    w.board = makeBoard();
    w.board.group.position.set(0, 0.8, -16);
    w.board.group.scale.setScalar(1.6);
    scene.add(w.board.group);
    w.boardClock = { cycle: -1, next: 0 };

    // 紙吹雪とハート
    scene.add(w.confetti = makeFalling(new T.PlaneGeometry(0.14, 0.22), new T.MeshBasicMaterial({ side: T.DoubleSide }), w.lite ? 110 : 260, CONFETTI, [0.8, 1.6]));
    const heart = new T.ExtrudeGeometry(heartShape(), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3, curveSegments: 10 });
    heart.center();
    heart.scale(0.55, 0.55, 0.55);
    scene.add(w.hearts = makeFalling(heart, new T.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 1, emissive: srgb('#40001c') }), w.lite ? 16 : 34, ['#ff3ca0', '#ff7ac8', '#ff1f5a', '#ffffff'], [0.4, 0.9]));

    // 周回する平成グッズ（画像の準備ができたら加える）
    w.ring = new T.Group();
    w.ring.position.set(0, 0.9, -0.5);
    scene.add(w.ring);
    buildGoods(w, opts);

    w.post = w.lite ? null : makePost(renderer);
    return w;
  }

  async function buildGoods(w, opts) {
    const ver = w.goodsVer = (w.goodsVer || 0) + 1;
    const list = await goodsCanvases(opts);
    if (world !== w || ver !== w.goodsVer) return; // 途中で止めた・作り直した
    w.ring.children.slice().forEach(s => { s.material.map.dispose(); s.material.dispose(); w.ring.remove(s); });
    list.forEach((it, i) => {
      const tex = new T.CanvasTexture(it.cv);
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = 4;
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, fog: false }));
      const aspect = it.cv.width / it.cv.height;
      s.userData = { base: new T.Vector2(it.size * Math.min(aspect, 1.9), it.size * Math.min(aspect, 1.9) / aspect), phase: i / list.length * TAU };
      s.scale.set(0.001, 0.001, 1);
      w.ring.add(s);
    });
  }

  // ---- パネル：見えていない側の面に次の見た目を描いてから、半回転させる ----
  // 回っている途中のパネルは、回り終わってから次の見た目に裏返す
  const tileRow = i => Math.floor(i / 5), tileCol = i => i % 5;
  function wantTile(tile, look, at) { tile.userData.want = look; tile.userData.wantAt = at; }
  function flipTile(w, tile, t) {
    const u = tile.userData, look = u.want;
    u.want = undefined;
    if (u.look === look) return;
    const hidden = u.faces[1 - u.side].material;
    if (look < 0) { hidden.map = w.board.numbers[u.i]; hidden.color.set('#ffffff'); hidden.emissive.set('#000000'); }
    else { hidden.map = w.board.gloss; hidden.color.set(look === 99 ? '#ff3ca0' : CONFETTI[look]); hidden.emissive.set(look === 99 ? '#5a0030' : '#000000'); }
    u.look = look; u.side = 1 - u.side;
    u.from = tile.rotation.y; u.to = u.from + Math.PI; u.t0 = t;
  }
  // 20秒ごとに：11秒間ランダムに色が変わる → 中央から波のようにハートを描く → 番号に戻す
  function animateBoard(w, t) {
    const c = w.boardClock, tiles = w.board.tiles;
    const lt = t - 2, cycle = Math.floor(lt / 20), local = lt - cycle * 20;
    if (cycle !== c.cycle) Object.assign(c, { cycle, heart: false, reset: false });
    if (local < 11) {
      if (t >= c.next) {
        for (let k = 0; k < 2; k++) wantTile(tiles[Math.floor(Math.random() * 25)], Math.floor(Math.random() * 6), t + k * 0.15);
        c.next = t + 0.45;
      }
    } else if (!c.heart) {
      c.heart = true;
      tiles.forEach(tl => { const i = tl.userData.i; wantTile(tl, HEART[i] ? 99 : -1, t + 0.1 * Math.max(Math.abs(tileCol(i) - 2), Math.abs(tileRow(i) - 2))); });
    } else if (local >= 16.5 && !c.reset) {
      c.reset = true;
      tiles.forEach(tl => { const i = tl.userData.i; wantTile(tl, -1, t + 0.06 * (tileRow(i) + tileCol(i))); });
    }
    tiles.forEach(tl => {
      const u = tl.userData;
      if (u.want !== undefined && t >= u.wantAt && t >= u.t0 + u.dur) flipTile(w, tl, t);
      const k = clamp((t - u.t0) / u.dur, 0, 1);
      tl.rotation.y = u.from + (u.to - u.from) * ease.inOut(k);
      tl.position.z = Math.sin(k * Math.PI) * 0.6;
      if (u.look === 99) u.faces[u.side].material.emissiveIntensity = 1 + Math.sin(t * 4) * 0.8;
    });
    w.board.group.rotation.y = Math.sin(t * 0.21) * 0.12;
    w.board.group.rotation.x = 0.06 + Math.sin(t * 0.17) * 0.04;
  }

  // ---- ロゴの上の星：消えた枠に、ランダムな文字の面取りの上で新しく光らせる ----
  const _v = new T.Vector3();
  function animateGlints(w, t, dt) {
    const pos = w.glints.geometry.attributes.position, size = w.glints.geometry.attributes.size;
    const letters = w.logo.letters.filter(l => l.visible && l.userData.glints.length);
    w.glints.userData.slots.forEach((s, i) => {
      s.t += dt;
      if (s.t > s.life) {
        s.t = -rand(0.2, 1.6);
        s.letter = letters.length ? letters[Math.floor(Math.random() * letters.length)] : null;
        s.at = s.letter ? s.letter.userData.glints[Math.floor(Math.random() * s.letter.userData.glints.length)] : null;
      }
      const on = s.t > 0 && s.letter;
      if (on) { _v.copy(s.at); s.letter.localToWorld(_v); pos.setXYZ(i, _v.x, _v.y, _v.z + 0.05); }
      size.setX(i, on ? Math.sin(s.t / s.life * Math.PI) * (1.2 + (i % 3) * 0.5) : 0);
    });
    pos.needsUpdate = true; size.needsUpdate = true;
  }

  // ---- 毎フレームの動き ----
  const LOGO_SCALE = 1.25;
  const INTRO = { fly: 1.8, first: 0.9, gap: 0.16, drop: 0.7 };
  function animate(w, t, dt) {
    const letters = w.logo.letters, n = letters.length;
    const landed = INTRO.first + (n - 1) * INTRO.gap + INTRO.drop; // 最後の文字が着地する時刻
    const sinceLand = t - landed;

    // カメラ：遠くからワープして近づき、あとはゆっくり左右に回る
    const k = ease.outCubic(clamp(t / INTRO.fly, 0, 1));
    const cam = w.camera, D = w.camDist;
    const yaw = Math.sin(t * 0.13) * 0.22 * k + w.mouse.x * 0.05, pitch = 0.05 + Math.sin(t * 0.11) * 0.04 + w.mouse.y * 0.03;
    const dist = D + (1 - k) * 55;
    const shake = Math.max(0, 1 - Math.abs(sinceLand) * 3) * 0.12;
    cam.position.set(Math.sin(yaw) * dist + rand(-shake, shake), 0.4 + Math.sin(pitch) * dist * 0.35 + rand(-shake, shake), Math.cos(yaw) * dist);
    cam.lookAt(0, w.lookY, 0);
    cam.rotation.z += (1 - k) * 0.5;
    w.stars.material.uniforms.uWarp.value = (1 - k) * 6;

    // 文字が1つずつ回りながら落ちてきて、ボヨンと着地する
    letters.forEach((l, i) => {
      const u = l.userData, t0 = INTRO.first + i * INTRO.gap;
      const d = clamp((t - t0) / INTRO.drop, 0, 1);
      l.visible = t >= t0;
      const e = ease.outBack(d), f = 1 - ease.outCubic(d);
      l.position.set(u.home.x * (1 + f * 0.8), u.home.y + f * 7 + Math.sin(t * 2.2 - i * 0.55) * 0.07 * (1 - f), u.home.z + f * 5);
      l.rotation.set(-f * 1.2, f * TAU * (i % 2 ? -1 : 1) + Math.sin(t * 1.1 - i * 0.4) * 0.12 * (1 - f), f * 0.6);
      l.scale.setScalar(0.4 + 0.6 * e);
    });
    w.logoRoot.rotation.y = Math.sin(t * 0.4) * 0.2;
    w.logoRoot.rotation.x = Math.sin(t * 0.3) * 0.05;

    // 着地：白い閃光、衝撃波、虹の輪、「ATTACK 25」
    const flash = sinceLand >= 0 ? Math.exp(-sinceLand * 4) * 0.7 : 0;
    const sw = clamp(sinceLand / 1.1, 0, 1);
    w.shock.visible = sinceLand >= 0 && sw < 1;
    w.shock.scale.setScalar(1 + ease.outCubic(sw) * 13);
    w.shock.material.opacity = (1 - sw) * 0.9;
    w.halo.material.uniforms.uTime.value = t;
    w.halo.material.uniforms.uBoost.value = sinceLand >= 0 ? Math.exp(-sinceLand * 1.5) * 1.5 + 0.25 * (1 + Math.sin(t * 2)) * 0.5 : 0;
    w.halo.scale.set(1.3 * (0.6 + 0.4 * clamp(sinceLand * 2, 0, 1)), 0.6 * (0.6 + 0.4 * clamp(sinceLand * 2, 0, 1)), 1);
    const sk = clamp((sinceLand - 0.2) / 0.5, 0, 1);
    w.sub.material.opacity = sk;
    w.sub.scale.setScalar(0.6 + 0.4 * ease.outBack(sk));
    w.bg.material.uniforms.uTime.value = t;
    w.bg.material.uniforms.uPulse.value = flash + 0.5 + 0.5 * Math.sin(t * 1.7);
    w.stars.material.uniforms.uTime.value = t;

    // キラーン：7秒ごとに光がロゴの前を横切る（最初は着地の直後）
    const sweepT = sinceLand < 0 ? -1 : (sinceLand % 7) / 1.6;
    const on = sweepT >= 0 && sweepT <= 1;
    w.sweep.intensity = on ? Math.sin(sweepT * Math.PI) * 80 : 0;
    w.sweep.position.set(-10 + 20 * ease.inOut(clamp(sweepT, 0, 1)), w.logoRoot.position.y + 0.8, 3.2);
    if (w.post) {
      const u = w.post.uniforms;
      _v.copy(w.sweep.position).project(cam);
      u.uFlarePos.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      u.uFlare.value = on ? Math.pow(Math.sin(sweepT * Math.PI), 2) * 0.9 : 0;
      u.uFlash.value = flash;
      u.uBloom.value = 1;
    }

    animateGlints(w, t, dt);
    if (t > 2) animateBoard(w, t);
    updateFalling(w.confetti, dt, t);
    updateFalling(w.hearts, dt, t);

    // グッズは傾いた楕円の上を回る。奥へ行くと小さく、少し暗くなる
    w.ring.children.forEach((s, i) => {
      const a = s.userData.phase + t * 0.16;
      const appear = clamp((sinceLand - 0.3 - i * 0.05) / 0.5, 0, 1);
      s.position.set(Math.cos(a) * w.ringR, -Math.sin(a) * 2.2 + Math.sin(t * 1.5 + i) * 0.25, Math.sin(a) * 4.5);
      const sc = ease.outBack(appear) * (0.85 + 0.15 * Math.sin(a));
      s.scale.set(s.userData.base.x * sc, s.userData.base.y * sc, 1);
      s.material.rotation = Math.sin(t * 2.6 + i * 1.3) * 0.12;
      s.material.color.setScalar(0.75 + 0.25 * (Math.sin(a) * 0.5 + 0.5));
    });
  }

  // ---- 画面の大きさと画質 ----
  function resize() {
    const w = world;
    if (!w) return;
    const W = window.innerWidth, H = window.innerHeight;
    const cap = Math.sqrt(1920 * 1080 * 1.3 / (W * H)); // フルHD強より細かくは描かない
    renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2, cap) * w.quality * (w.lite ? 0.75 : 1)));
    renderer.setSize(W, H, false);
    const cam = w.camera;
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    // ロゴが横に収まる距離まで下がる（縦長の画面でははみ出さないよう遠くなる）
    const halfV = Math.tan(cam.fov * Math.PI / 360);
    w.camDist = Math.max(17, (w.logo.width * LOGO_SCALE / 2 + 1.2) / (halfV * cam.aspect));
    w.lookY = -0.4; // ロゴを画面の上寄りに置き、下にチーム名の場所を空ける
    w.ringR = clamp(halfV * cam.aspect * w.camDist * 0.78, 7, 11);
    if (w.post) { const s = renderer.getDrawingBufferSize(new T.Vector2()); w.post.setSize(s.x, s.y); }
    const px = renderer.getPixelRatio() * H / 720;
    w.stars.material.uniforms.uScale.value = px;
    w.glints.material.uniforms.uScale.value = px;
    w.bg.material.uniforms.uAspect.value = W / H;
  }
  // 重いPCでは、まず解像度を下げ、それでも重ければ光のにじみをやめる
  function adapt(w, t, dt) {
    if (t < 4) return;
    const p = w.perf;
    p.sum += dt; p.n++;
    if (p.sum < 2) return;
    const avg = p.sum / p.n;
    p.sum = 0; p.n = 0;
    if (avg <= 1 / 40) return;
    if (w.quality > 0.6) { w.quality *= 0.8; resize(); }
    else if (w.post) { w.post.dispose(); w.post = null; }
  }
  function frame() {
    const w = world;
    if (!w) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - w.last) / 1000);
    w.last = now;
    const t = (now - w.t0) / 1000;
    animate(w, t, dt);
    if (w.post) w.post.render(w.scene, w.camera);
    else { renderer.setRenderTarget(null); renderer.render(w.scene, w.camera); }
    adapt(w, t, dt);
  }
  const onMouse = e => { if (world) world.mouse.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2); };
  function dispose(w) {
    w.scene.traverse(o => {
      if (o.geometry && !o.isSprite) o.geometry.dispose(); // Sprite の形は three.js 全体で共有なので捨てない
      [].concat(o.material || []).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    w.board.numbers.forEach(tex => tex.dispose());
    w.board.gloss.dispose();
    w.envRT.dispose();
    if (w.post) w.post.dispose();
  }
  const webgl2 = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } };

  window.Title3D = {
    // opts: { title, art, logos, photos, photoVer, lite }。WebGL が使えなければ false を返す
    start(opts) {
      if (world) { this.update(opts); return true; }
      if (!renderer) {
        if (!webgl2()) return false;
        canvas = document.createElement('canvas');
        canvas.id = 't3d';
        document.body.prepend(canvas);
        try { renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
        catch (e) { canvas.remove(); canvas = null; return false; }
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.9;
      }
      world = buildWorld(opts);
      world.mouse = new T.Vector2();
      canvas.style.display = 'block';
      resize();
      addEventListener('resize', resize);
      addEventListener('mousemove', onMouse);
      renderer.setAnimationLoop(frame);
      return true;
    },
    update(opts) {
      if (!world) return;
      const old = world.opts;
      world.opts = opts;
      if (opts.photoVer !== old.photoVer) buildGoods(world, opts);
    },
    stop() {
      if (!world) return;
      renderer.setAnimationLoop(null);
      removeEventListener('resize', resize);
      removeEventListener('mousemove', onMouse);
      dispose(world);
      world = null;
      canvas.style.display = 'none';
    },
  };
})();
