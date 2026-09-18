// ---------- 배경 파티클(반딧불/꽃가루) 생성 ----------
function createParticles(container, count) {
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("span");
    particle.className = "particle";

    const size = Math.random() * 3 + 1.5; // 1.5px ~ 4.5px
    const left = Math.random() * 100; // vw
    const duration = Math.random() * 10 + 12; // 12s ~ 22s
    const delay = Math.random() * 20; // 0s ~ 20s

    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${left}vw`;
    particle.style.animationDuration = `${duration}s`;
    particle.style.animationDelay = `${delay}s`;

    container.appendChild(particle);
  }
}

// ---------- 화면 전환 ----------
const screens = {
  intro: document.getElementById("screen-intro"),
  measure: document.getElementById("screen-measure"),
  result: document.getElementById("screen-result"),
  grow: document.getElementById("screen-grow"),
  garden: document.getElementById("screen-garden"),
};

function showScreen(name) {
  Object.values(screens).forEach((screen) => {
    if (screen) {
      screen.classList.remove("is-active");
    }
  });

  const target = screens[name];
  if (target) {
    target.classList.add("is-active");
  }
}

// ---------- 체감시간 측정 ----------
let measureStartTime = null;
let lastElapsedSeconds = 0;
let lastDiffSeconds = 0;
// 이 시간 경험 하나만의 "개성"을 결정하는 랜덤 시드. 실제로 흐른 시간(성장량)과는
// 완전히 분리된 값으로, 측정이 끝나는 순간 한 번만 생성되고 그 뒤로는 계속 재사용된다
// (결과 화면 → 정원에 심기까지 같은 값을 그대로 써서 항상 같은 모습이 되도록).
let lastRandomSeed = 0;

function formatSigned(diffSeconds) {
  const rounded = Math.abs(diffSeconds).toFixed(1);
  const sign = rounded === "0.0" ? "+" : diffSeconds >= 0 ? "+" : "-";
  return `${sign}${rounded}초`;
}

function startMeasuring() {
  measureStartTime = performance.now();
  showScreen("measure");
}

function finishMeasuring() {
  if (measureStartTime === null) {
    return;
  }

  const elapsedMs = performance.now() - measureStartTime;
  lastElapsedSeconds = elapsedMs / 1000;
  lastDiffSeconds = lastElapsedSeconds - 60;
  // 이번 시간 경험의 개성(랜덤 시드)은 측정이 끝나는 이 순간 딱 한 번만 새로 만든다.
  lastRandomSeed = Math.random() * 100000;

  const actualTimeEl = document.getElementById("actualTimeValue");
  const diffTimeEl = document.getElementById("diffTimeValue");

  if (actualTimeEl) {
    actualTimeEl.textContent = `${lastElapsedSeconds.toFixed(1)}초`;
  }
  if (diffTimeEl) {
    diffTimeEl.textContent = formatSigned(lastDiffSeconds);
  }

  measureStartTime = null;
  showScreen("result");
}

// ---------- 시간 → 식물 변환 ----------
const PLANT_COLORS = {
  teal: { r: 90, g: 196, b: 186 },
  moss: { r: 127, g: 168, b: 127 },
  amber: { r: 217, g: 178, b: 106 },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mixColor(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function colorToCss(color, alpha) {
  if (alpha === undefined) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

// 잎/줄기에 쓰는 세이지그린 / 뮤트민트 / 소프트 블루그린 팔레트 (미세하게 섞어 단조롭지 않게)
const LEAF_PALETTE = [
  { r: 142, g: 168, b: 140 }, // sage green
  { r: 150, g: 196, b: 176 }, // muted mint
  { r: 138, g: 180, b: 188 }, // soft blue-green
];

function leafColorFor(t) {
  const clamped = clamp(t, 0, 1);
  if (clamped < 0.5) {
    return mixColor(LEAF_PALETTE[0], LEAF_PALETTE[1], clamped * 2);
  }
  return mixColor(LEAF_PALETTE[1], LEAF_PALETTE[2], (clamped - 0.5) * 2);
}

// stroke-dasharray/offset을 이용해 "그려지는" 성장 애니메이션을 만든다.
// 새로 DOM에 삽입된 요소를 대상으로 하므로, 지연 시간은 항상 삽입 시점(=화면 진입 시점) 기준으로 흐른다.
function animateStrokeDraw(pathEl, delaySeconds, durationSeconds) {
  const length = pathEl.getTotalLength();
  pathEl.style.strokeDasharray = `${length}`;
  pathEl.style.strokeDashoffset = `${length}`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pathEl.style.transition = `stroke-dashoffset ${durationSeconds}s var(--ease-soft) ${delaySeconds}s`;
      pathEl.style.strokeDashoffset = "0";
    });
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";
let growRevealTimeoutId = null;
let plantSvgInstanceCounter = 0;

// 정원에는 여러 식물의 <svg>가 한 문서 안에 동시에 존재할 수 있으므로,
// 필터 id가 서로 겹치지 않도록(중복 id는 엉뚱한 식물의 글로우를 참조하게 됨)
// svg를 그릴 때마다 고유한 id를 만들어 사용한다.
function ensurePlantGlowFilters(svg) {
  plantSvgInstanceCounter += 1;
  const tipFilterId = `plantGlowBlur-${plantSvgInstanceCounter}`;
  const ambientFilterId = `plantAmbientBlur-${plantSvgInstanceCounter}`;

  const defs = document.createElementNS(SVG_NS, "defs");

  const tipFilter = document.createElementNS(SVG_NS, "filter");
  tipFilter.setAttribute("id", tipFilterId);
  tipFilter.setAttribute("x", "-120%");
  tipFilter.setAttribute("y", "-120%");
  tipFilter.setAttribute("width", "340%");
  tipFilter.setAttribute("height", "340%");
  const tipBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  tipBlur.setAttribute("stdDeviation", "5");
  tipFilter.appendChild(tipBlur);

  // 식물 전체를 은은하게 감싸는, 밤에 스스로 빛나는 듯한 넓은 앰비언트 글로우용 블러
  const ambientFilter = document.createElementNS(SVG_NS, "filter");
  ambientFilter.setAttribute("id", ambientFilterId);
  ambientFilter.setAttribute("x", "-150%");
  ambientFilter.setAttribute("y", "-150%");
  ambientFilter.setAttribute("width", "400%");
  ambientFilter.setAttribute("height", "400%");
  const ambientBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  ambientBlur.setAttribute("stdDeviation", "22");
  ambientFilter.appendChild(ambientBlur);

  defs.appendChild(tipFilter);
  defs.appendChild(ambientFilter);
  svg.appendChild(defs);

  return { tipFilterId, ambientFilterId };
}

const LEAF_POP_DURATION = 0.85;
const FLOWER_BLOOM_DURATION = 0.75;

// 결과 화면과 정원 모두 아래쪽에 정의된 renderWildflowerPlant() 하나를 공유해서 사용한다.
// (실제로 흐른 시간 = 성장량, randomSeed = 개성 을 분리하는 통합 식물 생성 시스템)

function goToGrowScreen() {
  showScreen("grow");

  const plantActualValueEl = document.getElementById("plantActualValue");
  const plantDiffValueEl = document.getElementById("plantDiffValue");

  if (plantActualValueEl) {
    plantActualValueEl.textContent = `${lastElapsedSeconds.toFixed(1)}초`;
  }
  if (plantDiffValueEl) {
    plantDiffValueEl.textContent = formatSigned(lastDiffSeconds);
  }

  buildAndGrowPlant(lastElapsedSeconds, lastRandomSeed);
}

// ---------- 나의 정원 (localStorage에 저장되는 여러 식물) ----------
const GARDEN_STORAGE_KEY = "timeGardenPlants";

const PLANT_LABELS = ["첫 번째 시간", "두 번째 시간", "세 번째 시간", "네 번째 시간", "다섯 번째 시간"];

function plantLabelFor(index) {
  return PLANT_LABELS[index] || `${index + 1}번째 시간`;
}

function loadGardenPlants() {
  try {
    const raw = localStorage.getItem(GARDEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[체감시간의 정원] 저장된 정원을 불러오지 못했습니다.", error);
    return [];
  }
}

function saveGardenPlants(plants) {
  try {
    localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(plants));
  } catch (error) {
    console.warn("[체감시간의 정원] 정원을 저장하지 못했습니다.", error);
  }
}

// 정원에 심어진 식물 데이터만 지운다. 시간 측정 기능이나 다른 설정에는 영향을 주지 않는다.
function clearGardenPlants() {
  try {
    localStorage.removeItem(GARDEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[체감시간의 정원] 정원을 초기화하지 못했습니다.", error);
  }
}

// ---------- 야생화 디자인 시스템 (결과 화면 · 정원 공용) ----------
// 결과 화면에서 자라나는 식물과 정원에 심어진 식물은 이 시스템 하나를 그대로 공유한다.
// "같은 식물이 크기만 다른" 것이 아니라, 서로 다른 실루엣(6가지 유형) + 서로 다른
// 꽃 모양(6가지) + 서로 다른 파스텔 색 조합 + 잎 모양으로 각 식물이 하나의 야생화
// "종"처럼 보이도록 한다. (elapsedSeconds, randomSeed) 두 값만으로 전부 결정되므로
// (이 두 값 자체를 만드는 순간 외에는 Math.random 없음) 같은 값이면 새로고침해도,
// 결과 화면에서 정원으로 옮겨도 항상 같은 모습이 나온다.

// sin 기반의 결정론적 유사난수: 같은 seed면 항상 같은 값, seed가 다르면 서로 무관하게 흩어진다.
function hash01(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function pickIndex(seed, count) {
  return Math.min(count - 1, Math.floor(hash01(seed) * count));
}

function quadPoint(t, p0, p1, p2) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

// 파스텔 톤 팔레트 — 낮은 채도로 어두운 배경과 어울리게
const GARDEN_PALETTE = [
  { r: 208, g: 196, b: 226 }, // pastel lavender
  { r: 176, g: 158, b: 206 }, // soft violet
  { r: 240, g: 214, b: 140 }, // butter yellow
  { r: 247, g: 232, b: 188 }, // cream yellow
  { r: 235, g: 178, b: 128 }, // apricot orange
  { r: 244, g: 200, b: 170 }, // peach
  { r: 236, g: 190, b: 202 }, // blush pink
  { r: 205, g: 150, b: 155 }, // dusty rose
];

// 식물마다 이 조합 중 하나를 골라 "그 식물만의" 2색 조합을 갖는다 (한 식물에 모든 색 X)
const GARDEN_PALETTE_COMBOS = [
  [1, 3], // soft violet + cream yellow
  [2, 4], // butter yellow + apricot orange
  [6, 0], // blush pink + pastel lavender
  [5, 3], // peach + cream yellow
  [0, 3], // pastel lavender + cream yellow
  [7, 5], // dusty rose + peach
  [4, 6], // apricot orange + blush pink
  [2, 7], // butter yellow + dusty rose
];

const GARDEN_FLOWER_CENTER = { r: 250, g: 228, b: 160 };
const GARDEN_LEAF_SHAPES = ["slender", "oval", "round", "pointed"];
const GARDEN_FLOWER_SHAPES = ["round5", "elongated6", "daisy", "star", "bell", "cluster"];

function appendGardenLeaf(group, shape, len, w, fillCss) {
  if (shape === "oval") {
    // 작은 타원형 잎
    const el = document.createElementNS(SVG_NS, "ellipse");
    el.setAttribute("cx", (len * 0.5).toFixed(2));
    el.setAttribute("cy", "0");
    el.setAttribute("rx", (len * 0.5).toFixed(2));
    el.setAttribute("ry", (w * 0.85).toFixed(2));
    el.setAttribute("fill", fillCss);
    group.appendChild(el);
    return;
  }
  if (shape === "round") {
    // 둥근 잎
    const el = document.createElementNS(SVG_NS, "ellipse");
    el.setAttribute("cx", (len * 0.42).toFixed(2));
    el.setAttribute("cy", "0");
    el.setAttribute("rx", (len * 0.46).toFixed(2));
    el.setAttribute("ry", (len * 0.42).toFixed(2));
    el.setAttribute("fill", fillCss);
    group.appendChild(el);
    return;
  }
  // "slender"(길쭉한 잎) / "pointed"(끝이 뾰족한 잎)
  const isPointed = shape === "pointed";
  const bow = isPointed ? w * 0.9 : w * 0.7;
  const tipT = isPointed ? 0.28 : 0.44;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    `M0,0 Q${(len * tipT).toFixed(2)},${(-bow).toFixed(2)} ${len.toFixed(2)},0 ` +
      `Q${(len * tipT).toFixed(2)},${bow.toFixed(2)} 0,0 Z`
  );
  path.setAttribute("fill", fillCss);
  group.appendChild(path);
}

function appendFlowerCenter(group, r, color) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("r", r.toFixed(2));
  c.setAttribute("fill", colorToCss(color, 0.95));
  group.appendChild(c);
}

function drawPetalRing(group, opts) {
  const { petalCount, radius, rx, ry, colorA, colorB, rotationOffset } = opts;
  for (let i = 0; i < petalCount; i++) {
    const angle = (360 / petalCount) * i + rotationOffset;
    const rad = (angle * Math.PI) / 180;
    const px = Math.cos(rad) * radius;
    const py = Math.sin(rad) * radius;
    const petal = document.createElementNS(SVG_NS, "ellipse");
    petal.setAttribute("cx", px.toFixed(2));
    petal.setAttribute("cy", py.toFixed(2));
    petal.setAttribute("rx", rx.toFixed(2));
    petal.setAttribute("ry", ry.toFixed(2));
    petal.setAttribute("transform", `rotate(${angle.toFixed(1)} ${px.toFixed(2)} ${py.toFixed(2)})`);
    petal.setAttribute("fill", colorToCss(i % 2 === 0 ? colorA : colorB, 0.86));
    group.appendChild(petal);
  }
}

// 꽃 모양 6종: 둥근5잎 / 길쭉한6잎 / 데이지 / 별 / 종모양(아래로 처짐) / 작은 꽃 여러 개가 모인 형태
function appendFlowerShape(group, shape, size, colorA, colorB, centerColor, rotationOffset) {
  switch (shape) {
    case "elongated6":
      drawPetalRing(group, { petalCount: 6, radius: size * 0.46, rx: size * 0.6, ry: size * 0.15, colorA, colorB, rotationOffset });
      appendFlowerCenter(group, size * 0.15, centerColor);
      break;

    case "daisy":
      drawPetalRing(group, { petalCount: 10, radius: size * 0.42, rx: size * 0.5, ry: size * 0.09, colorA, colorB, rotationOffset });
      appendFlowerCenter(group, size * 0.26, centerColor);
      break;

    case "star": {
      const points = 5;
      const outerR = size * 0.55;
      const innerR = size * 0.22;
      let d = "";
      for (let vi = 0; vi < points * 2; vi++) {
        const r = vi % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / points) * vi - Math.PI / 2 + (rotationOffset * Math.PI) / 180;
        const vx = Math.cos(angle) * r;
        const vy = Math.sin(angle) * r;
        d += `${vi === 0 ? "M" : "L"}${vx.toFixed(2)},${vy.toFixed(2)} `;
      }
      d += "Z";
      const star = document.createElementNS(SVG_NS, "path");
      star.setAttribute("d", d);
      star.setAttribute("fill", colorToCss(colorA, 0.86));
      group.appendChild(star);
      appendFlowerCenter(group, size * 0.14, centerColor);
      break;
    }

    case "bell": {
      // 위(줄기 쪽)는 좁고 아래로 살짝 처지며 벌어지는 종 모양 실루엣
      const neckW = size * 0.14;
      const mouthW = size * 0.5;
      const tube = document.createElementNS(SVG_NS, "path");
      tube.setAttribute(
        "d",
        `M0,${(-neckW).toFixed(2)} Q${(size * 0.55).toFixed(2)},${(-mouthW * 0.7).toFixed(2)} ${size.toFixed(2)},${(-mouthW).toFixed(2)} ` +
          `A${(mouthW * 0.5).toFixed(2)},${(mouthW * 0.5).toFixed(2)} 0 0 1 ${size.toFixed(2)},${mouthW.toFixed(2)} ` +
          `Q${(size * 0.55).toFixed(2)},${(mouthW * 0.7).toFixed(2)} 0,${neckW.toFixed(2)} Z`
      );
      tube.setAttribute("fill", colorToCss(colorA, 0.82));
      group.appendChild(tube);

      const rim = document.createElementNS(SVG_NS, "ellipse");
      rim.setAttribute("cx", size.toFixed(2));
      rim.setAttribute("cy", "0");
      rim.setAttribute("rx", (mouthW * 0.4).toFixed(2));
      rim.setAttribute("ry", (mouthW * 0.48).toFixed(2));
      rim.setAttribute("fill", colorToCss(centerColor, 0.65));
      group.appendChild(rim);
      break;
    }

    case "cluster": {
      // 작은 꽃 여러 송이가 모여 있는 형태
      const miniCount = 4;
      for (let mi = 0; mi < miniCount; mi++) {
        const angle = (360 / miniCount) * mi + rotationOffset;
        const rad = (angle * Math.PI) / 180;
        const cx = Math.cos(rad) * size * 0.3;
        const cy = Math.sin(rad) * size * 0.3;
        const mini = document.createElementNS(SVG_NS, "g");
        mini.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`);
        drawPetalRing(mini, {
          petalCount: 5,
          radius: size * 0.16,
          rx: size * 0.18,
          ry: size * 0.14,
          colorA: mi % 2 === 0 ? colorA : colorB,
          colorB: mi % 2 === 0 ? colorB : colorA,
          rotationOffset: angle,
        });
        appendFlowerCenter(mini, size * 0.07, centerColor);
        group.appendChild(mini);
      }
      break;
    }

    case "round5":
    default:
      drawPetalRing(group, { petalCount: 5, radius: size * 0.32, rx: size * 0.34, ry: size * 0.27, colorA, colorB, rotationOffset });
      appendFlowerCenter(group, size * 0.15, centerColor);
      break;
  }
}

function appendBudShape(group, size, color) {
  const bud = document.createElementNS(SVG_NS, "ellipse");
  bud.setAttribute("cx", "0");
  bud.setAttribute("cy", (-size * 0.1).toFixed(2));
  bud.setAttribute("rx", (size * 0.28).toFixed(2));
  bud.setAttribute("ry", (size * 0.42).toFixed(2));
  bud.setAttribute("fill", colorToCss(color, 0.8));
  group.appendChild(bud);
}

// 줄기/가지 한 구간을 살짝 휜 곡선으로 그린다. 완전한 직선을 피하기 위해 항상 bow(휘는 정도)를 받는다.
function appendCurvePath(svg, from, to, bow, strokeWidth, colorCss, isMainStem) {
  const midX = (from.x + to.x) / 2 + bow;
  const midY = (from.y + to.y) / 2;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
  );
  path.setAttribute("stroke", colorCss);
  path.setAttribute("stroke-width", strokeWidth.toFixed(2));
  path.classList.add(isMainStem ? "plant-stem" : "plant-branch");
  svg.appendChild(path);
  return { from, mid: { x: midX, y: midY }, to };
}

function appendLeafAt(svg, point, angleDeg, size, shape, colorCss) {
  const anchor = document.createElementNS(SVG_NS, "g");
  anchor.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`);
  const animated = document.createElementNS(SVG_NS, "g");
  animated.classList.add("plant-leaf");
  appendGardenLeaf(animated, shape, size, size * 0.42, colorCss);
  anchor.appendChild(animated);
  svg.appendChild(anchor);
}

function appendBloomAt(svg, point, angleDeg, size, shape, colorA, colorB, centerColor, rotationOffset, isBud) {
  const anchor = document.createElementNS(SVG_NS, "g");
  anchor.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`);
  const animated = document.createElementNS(SVG_NS, "g");
  animated.classList.add(isBud ? "plant-bud" : "plant-flower");
  if (isBud) {
    appendBudShape(animated, size * 0.62, colorA);
  } else {
    appendFlowerShape(animated, shape, size, colorA, colorB, centerColor, rotationOffset);
  }
  anchor.appendChild(animated);
  svg.appendChild(anchor);
}

// 자리(bloomPoints)가 필요한 개수보다 모자랄 때, 마지막 지점 근처에 짧은 꽃자루로 보충한다.
function placeSatelliteBlooms(ctx, anchorPoint, openCount, budCount, sizeBase) {
  const total = Math.max(0, openCount) + Math.max(0, budCount);
  for (let i = 0; i < total; i++) {
    const isBud = i < budCount;
    const seed = ctx.seedBase + 200 + i * 3.1;
    const angle = -90 + (hash01(seed) - 0.5) * 220;
    const dist = (10 + 14 * hash01(seed + 1)) * ctx.sizeScale;
    const point = {
      x: anchorPoint.x + Math.cos((angle * Math.PI) / 180) * dist,
      y: anchorPoint.y + Math.sin((angle * Math.PI) / 180) * dist,
    };
    appendCurvePath(ctx.svg, anchorPoint, point, (hash01(seed + 2) - 0.5) * 8, ctx.stemStroke * 0.28, ctx.branchColorCss, false);
    const size = (isBud ? 12 : 16 + 8 * hash01(seed + 3)) * ctx.sizeScale;
    appendBloomAt(ctx.svg, point, angle, size, ctx.flowerShapeName, ctx.colorA, ctx.colorB, ctx.centerColor, 360 * hash01(seed + 4), isBud);
  }
}

// 각 유형이 만들어 둔 "꽃이 필 수 있는 자리" 목록에 실제로 꽃/봉오리를 배정해 그린다.
// 뒤쪽 일부 자리를 봉오리로 지정해 "꽃 사이에 봉오리도 섞이도록" 한다.
function assignAndDrawBlooms(ctx, bloomPoints) {
  const total = ctx.openFlowerCount + ctx.budCount;
  if (bloomPoints.length === 0 || total <= 0) {
    return;
  }

  const n = Math.min(bloomPoints.length, total);
  for (let i = 0; i < n; i++) {
    const { point, angle } = bloomPoints[i];
    const isBud = ctx.budCount > 0 && i >= n - ctx.budCount;
    const seed = ctx.seedBase + 60 + i * 3.7;
    let size = (isBud ? 13 : 19 + 9 * hash01(seed)) * ctx.sizeScale;
    if (ctx.bigFirstBloom && i === 0 && !isBud) {
      size *= 1.7;
    }
    appendBloomAt(ctx.svg, point, angle, size, ctx.flowerShapeName, ctx.colorA, ctx.colorB, ctx.centerColor, 360 * hash01(seed + 1), isBud);
  }

  if (bloomPoints.length < total) {
    const shortfall = total - bloomPoints.length;
    const last = bloomPoints[bloomPoints.length - 1];
    placeSatelliteBlooms(ctx, last.point, shortfall, 0, 14);
  }
}

function drawGardenLeaves(ctx, leafPoints) {
  leafPoints.forEach((lp, i) => {
    const seed = ctx.seedBase + 90 + i * 2.9;
    const size = (15 + 7 * hash01(seed)) * ctx.sizeScale;
    appendLeafAt(ctx.svg, lp.point, lp.angle, size, ctx.leafShapeName, ctx.leafColorCss);
  });
}

// ---- TYPE A: 가느다란 줄기 끝에 비교적 큰 꽃 한 송이 ----
function buildGardenTypeSingleBloom(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 155 * sizeScale;
  const bow = 12 * sizeScale * (hash01(ctx.seedBase + 1) - 0.5) * 2;
  const tip = { x: base.x + bow * 0.4, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke, ctx.stemColorCss, true);

  const leafPoints = [];
  const leafN = clamp(Math.round(ctx.leafCount * 0.4), 0, ctx.leafCount);
  for (let i = 0; i < leafN; i++) {
    const t = 0.16 + (i / (leafN - 1 || 1)) * 0.5;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    const side = i % 2 === 0 ? -1 : 1;
    leafPoints.push({ point: pt, angle: -90 + side * (30 + 15 * hash01(ctx.seedBase + 3 + i)) });
  }

  const bloomPoints = [{ point: tip, angle: -90 }];
  const extra = ctx.openFlowerCount + ctx.budCount - 1;
  for (let i = 0; i < extra; i++) {
    const seed = ctx.seedBase + 40 + i * 3.3;
    const angle = -90 + (hash01(seed) - 0.5) * 200;
    const dist = (14 + 12 * hash01(seed + 1)) * sizeScale;
    const point = { x: tip.x + Math.cos((angle * Math.PI) / 180) * dist, y: tip.y + Math.sin((angle * Math.PI) / 180) * dist };
    appendCurvePath(svg, tip, point, (hash01(seed + 2) - 0.5) * 10, ctx.stemStroke * 0.3, ctx.branchColorCss, false);
    bloomPoints.push({ point, angle });
  }
  return { bloomPoints, leafPoints, tip };
}

// ---- TYPE B: 줄기가 여러 방향으로 갈라지고 작은 꽃 여러 송이 ----
function buildGardenTypeForking(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 118 * sizeScale;
  const bow = 8 * sizeScale * (hash01(ctx.seedBase + 1) - 0.5) * 2;
  const tip = { x: base.x + bow * 0.5, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke, ctx.stemColorCss, true);
  const forkPoint = quadPoint(0.55, stemCurve.from, stemCurve.mid, stemCurve.to);

  const leafPoints = [];
  const leafN = clamp(Math.round(ctx.leafCount * 0.7), 1, ctx.leafCount);
  for (let i = 0; i < leafN; i++) {
    const t = 0.14 + (i / (leafN - 1 || 1)) * 0.32;
    const side = i % 2 === 0 ? -1 : 1;
    leafPoints.push({
      point: quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to),
      angle: -90 + side * (28 + 14 * hash01(ctx.seedBase + 5 + i)),
    });
  }

  const branchN = clamp(Math.round(ctx.nBranches * 0.7), ctx.openFlowerCount + ctx.budCount > 0 ? 1 : 0, 6);
  const bloomPoints = [];
  for (let i = 0; i < branchN; i++) {
    const seed = ctx.seedBase + 20 + i * 4.4;
    const angle = -90 + (i - (branchN - 1) / 2) * 38 + (hash01(seed) - 0.5) * 22;
    const len = (46 + 28 * hash01(seed + 1)) * sizeScale;
    const subTip = {
      x: forkPoint.x + Math.cos((angle * Math.PI) / 180) * len,
      y: forkPoint.y + Math.sin((angle * Math.PI) / 180) * len,
    };
    appendCurvePath(svg, forkPoint, subTip, (hash01(seed + 2) - 0.5) * 20, ctx.stemStroke * 0.55, ctx.branchColorCss, false);
    bloomPoints.push({ point: subTip, angle });
  }
  return { bloomPoints, leafPoints, tip };
}

// ---- TYPE C: 키가 작고 둥근 잎이 많으며 작은 꽃들이 모여 핌 ----
function buildGardenTypeClusteredLow(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 68 * sizeScale;
  const bow = 6 * sizeScale * (hash01(ctx.seedBase + 1) - 0.5) * 2;
  const tip = { x: base.x + bow * 0.3, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke, ctx.stemColorCss, true);

  const leafPoints = [];
  const leafN = clamp(Math.round(ctx.leafCount * 1.2), 1, ctx.leafCount + 3);
  for (let i = 0; i < leafN; i++) {
    const t = 0.15 + (i / (leafN - 1 || 1)) * 0.6;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    const side = i % 2 === 0 ? -1 : 1;
    const seed = ctx.seedBase + 4 + i;
    const angle = -90 + side * (40 + 20 * hash01(seed));
    const branchLen = (13 + 7 * hash01(seed + 1)) * sizeScale;
    const leafPt = {
      x: pt.x + Math.cos((angle * Math.PI) / 180) * branchLen,
      y: pt.y + Math.sin((angle * Math.PI) / 180) * branchLen,
    };
    appendCurvePath(svg, pt, leafPt, (hash01(seed + 2) - 0.5) * 10, ctx.stemStroke * 0.4, ctx.branchColorCss, false);
    leafPoints.push({ point: leafPt, angle });
  }

  const bloomPoints = [];
  const clusterN = ctx.openFlowerCount + ctx.budCount;
  for (let i = 0; i < clusterN; i++) {
    const seed = ctx.seedBase + 50 + i * 3.3;
    const angle = (360 / clusterN) * i + 360 * hash01(seed);
    const r = (7 + 6 * hash01(seed + 1)) * sizeScale;
    const point = {
      x: tip.x + Math.cos((angle * Math.PI) / 180) * r,
      y: tip.y - 5 * sizeScale + Math.sin((angle * Math.PI) / 180) * r * 0.6,
    };
    bloomPoints.push({ point, angle: -90 + (hash01(seed + 2) - 0.5) * 60 });
  }
  return { bloomPoints, leafPoints, tip };
}

// ---- TYPE D: 긴 줄기에 작은 꽃이 위아래로 여러 개 (꽃차례) ----
function buildGardenTypeTallSpike(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 172 * sizeScale;
  const bow = 14 * sizeScale * (hash01(ctx.seedBase + 1) - 0.5);
  const tip = { x: base.x + bow * 0.5, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke * 0.85, ctx.stemColorCss, true);

  const total = ctx.openFlowerCount + ctx.budCount;
  const bloomPoints = [];
  for (let i = 0; i < total; i++) {
    const t = 0.28 + (i / (total - 1 || 1)) * 0.68;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    const side = i % 2 === 0 ? -1 : 1;
    const seed = ctx.seedBase + 70 + i * 2.7;
    const angle = -90 + side * (20 + 18 * hash01(seed));
    const dist = (8 + 6 * hash01(seed + 1)) * sizeScale;
    const point = { x: pt.x + Math.cos((angle * Math.PI) / 180) * dist, y: pt.y + Math.sin((angle * Math.PI) / 180) * dist };
    appendCurvePath(svg, pt, point, (hash01(seed + 2) - 0.5) * 8, ctx.stemStroke * 0.28, ctx.branchColorCss, false);
    bloomPoints.push({ point, angle });
  }

  const leafPoints = [];
  const leafN = clamp(Math.round(ctx.leafCount * 0.5), 1, ctx.leafCount);
  for (let i = 0; i < leafN; i++) {
    const t = 0.08 + (i / (leafN - 1 || 1)) * 0.2;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    const side = i % 2 === 0 ? 1 : -1;
    leafPoints.push({ point: pt, angle: -90 + side * 35 });
  }
  return { bloomPoints, leafPoints, tip };
}

// ---- TYPE E: 줄기가 살짝 휘어지고 좌우 비대칭으로 꽃이 피는 야생화 ----
function buildGardenTypeLeaningWild(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 128 * sizeScale;
  const leanDir = hash01(ctx.seedBase + 1) > 0.5 ? 1 : -1;
  const bow = leanDir * 34 * sizeScale;
  const tip = { x: base.x + bow * 0.8, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke, ctx.stemColorCss, true);

  const branchN = clamp(
    Math.round((ctx.nBranches + ctx.leafCount) * 0.55),
    ctx.openFlowerCount + ctx.budCount > 0 ? 2 : 0,
    14
  );
  const bloomPoints = [];
  const leafPoints = [];
  for (let i = 0; i < branchN; i++) {
    const seed = ctx.seedBase + 100 + i * 3.9;
    const t = 0.3 + (i / (branchN - 1 || 1)) * 0.6;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    const biased = hash01(seed) < 0.72 ? leanDir : -leanDir;
    const angle = -90 + biased * (30 + 26 * hash01(seed + 1));
    const len = (26 + 22 * hash01(seed + 2)) * sizeScale;
    const endPt = { x: pt.x + Math.cos((angle * Math.PI) / 180) * len, y: pt.y + Math.sin((angle * Math.PI) / 180) * len };
    appendCurvePath(svg, pt, endPt, biased * 10 * hash01(seed + 3), ctx.stemStroke * 0.45, ctx.branchColorCss, false);
    if (i % 2 === 0) {
      bloomPoints.push({ point: endPt, angle });
    } else {
      leafPoints.push({ point: endPt, angle });
    }
  }
  return { bloomPoints, leafPoints, tip };
}

// ---- TYPE F: 중앙 꽃 하나와 주변의 작은 꽃봉오리들 ----
function buildGardenTypeCenterWithBuds(ctx) {
  const { svg, base, sizeScale } = ctx;
  const stemH = 138 * sizeScale;
  const bow = 10 * sizeScale * (hash01(ctx.seedBase + 1) - 0.5) * 2;
  const tip = { x: base.x + bow * 0.4, y: base.y - stemH };
  const stemCurve = appendCurvePath(svg, base, tip, bow, ctx.stemStroke, ctx.stemColorCss, true);

  const leafPoints = [];
  const leafN = clamp(Math.round(ctx.leafCount * 0.5), 1, ctx.leafCount);
  for (let i = 0; i < leafN; i++) {
    const t = 0.22 + (i / (leafN - 1 || 1)) * 0.34;
    const pt = quadPoint(t, stemCurve.from, stemCurve.mid, stemCurve.to);
    leafPoints.push({ point: pt, angle: -90 + (i % 2 === 0 ? -1 : 1) * 34 });
  }

  const totalBlooms = ctx.openFlowerCount + ctx.budCount;
  const bloomPoints = totalBlooms > 0 ? [{ point: tip, angle: -90 }] : [];
  const ringN = Math.max(0, totalBlooms - 1);
  for (let i = 0; i < ringN; i++) {
    const seed = ctx.seedBase + 130 + i * 3.1;
    const angle = (360 / Math.max(1, ringN)) * i + 360 * hash01(seed);
    const r = (15 + 8 * hash01(seed + 1)) * sizeScale;
    const point = {
      x: tip.x + Math.cos((angle * Math.PI) / 180) * r,
      y: tip.y - 4 * sizeScale + Math.sin((angle * Math.PI) / 180) * r * 0.7,
    };
    appendCurvePath(svg, tip, point, (hash01(seed + 2) - 0.5) * 6, ctx.stemStroke * 0.26, ctx.branchColorCss, false);
    bloomPoints.push({ point, angle });
  }
  return { bloomPoints, leafPoints, tip };
}

const GARDEN_TYPE_BUILDERS = [
  buildGardenTypeSingleBloom, // TYPE A
  buildGardenTypeForking, // TYPE B
  buildGardenTypeClusteredLow, // TYPE C
  buildGardenTypeTallSpike, // TYPE D
  buildGardenTypeLeaningWild, // TYPE E
  buildGardenTypeCenterWithBuds, // TYPE F
];

// 이 두 값이 이 시스템 전체의 핵심 원칙이다:
//   growthT (elapsedSeconds에서만 계산) = 식물이 "얼마나 자랐는가" (성장량)
//   randomSeed (측정 완료 시 한 번 생성되어 저장되는 값) = 이 식물만의 "개성"
// 성장량과 개성은 서로 완전히 독립적인 입력이라서, 아주 짧은 시간이 화려하게 만개하거나
// 긴 시간이 새싹인 채로 남는 일이 없다 — 동시에 같은 성장 단계 안에서도 식물마다
// 형태(6종)·잎모양(4종)·꽃모양(6종)·색조합(8종)·미세한 흔들림이 저마다 다르다.
function computeGrowthLevel(elapsedSeconds) {
  // 0초=0, 10초≈0.22, 20초≈0.39, 35초≈0.58, 50초≈0.71, 65초≈0.80로 부드럽게 증가하다가
  // 아주 긴 시간에서도 1에 한없이 가까워지기만 할 뿐 넘지 않는다 (최대 크기 제한).
  const g = 1 - Math.exp(-elapsedSeconds / 40);

  return {
    g,
    sizeScale: clamp(0.1 + 0.9 * g, 0.1, 1),
    leafCount: clamp(Math.round(0.5 + 12 * g), 1, 14),
    nBranches: clamp(Math.round(Math.max(0, g - 0.15) * 8), 0, 8),
    budCount: clamp(Math.round(Math.max(0, g - 0.35) * 4.5), 0, 5),
    openFlowerCount: clamp(Math.round(Math.max(0, g - 0.55) * 13), 0, 9),
  };
}

// 저장된 (elapsedSeconds, randomSeed) 한 쌍만으로 식물 전체를 결정론적으로 그린다.
// animated가 true면(결과 화면) 새싹→줄기/가지→잎→봉오리→꽃 순서로 자라나는 모습을 보여주고,
// false면(정원 화면) 같은 형태를 지연 없이 완성된 모습으로 그린다. 두 경우 모두 좌표/색상
// 계산 로직이 완전히 같으므로 같은 (elapsedSeconds, randomSeed)에서는 항상 같은 식물이 나온다.
function renderWildflowerPlant(svg, elapsedSeconds, randomSeed, animated) {
  svg.innerHTML = "";
  const { tipFilterId, ambientFilterId } = ensurePlantGlowFilters(svg);

  const growth = computeGrowthLevel(elapsedSeconds);
  const seedBase = randomSeed;

  const typeIndex = pickIndex(seedBase * 0.913 + 4.7, GARDEN_TYPE_BUILDERS.length);
  const comboIndex = pickIndex(seedBase * 1.71 + 9.3, GARDEN_PALETTE_COMBOS.length);
  const leafShapeName = GARDEN_LEAF_SHAPES[pickIndex(seedBase * 2.37 + 15.1, GARDEN_LEAF_SHAPES.length)];
  const flowerShapeName = GARDEN_FLOWER_SHAPES[pickIndex(seedBase * 3.19 + 21.4, GARDEN_FLOWER_SHAPES.length)];

  const combo = GARDEN_PALETTE_COMBOS[comboIndex];
  const colorA = GARDEN_PALETTE[combo[0]];
  const colorB = GARDEN_PALETTE[combo[1]];
  const centerColor = mixColor(GARDEN_FLOWER_CENTER, colorA, 0.25);

  const leafTint = leafColorFor(hash01(seedBase * 1.27 + 3.3));
  const stemColorRgb = mixColor(PLANT_COLORS.moss, leafTint, 0.4);
  const branchColorRgb = mixColor(stemColorRgb, leafTint, 0.5);

  const base = { x: 200, y: 460 };
  const stemStroke = clamp(3.2 + 2 * growth.sizeScale, 3, 6.5);

  const ctx = {
    svg,
    base,
    sizeScale: growth.sizeScale,
    seedBase,
    stemStroke,
    stemColorCss: colorToCss(stemColorRgb),
    branchColorCss: colorToCss(branchColorRgb),
    leafColorCss: colorToCss(leafTint, 0.75),
    leafShapeName,
    flowerShapeName,
    colorA,
    colorB,
    centerColor,
    leafCount: growth.leafCount,
    nBranches: growth.nBranches,
    openFlowerCount: growth.openFlowerCount,
    budCount: growth.budCount,
    bigFirstBloom: typeIndex === 0,
  };

  // 은은한 앰비언트 글로우 (맨 뒤에 위치, 밤에 스스로 빛나는 듯한 느낌)
  const ambientGlow = document.createElementNS(SVG_NS, "ellipse");
  ambientGlow.setAttribute("cx", base.x.toFixed(1));
  ambientGlow.setAttribute("cy", (base.y - 90 * growth.sizeScale).toFixed(1));
  ambientGlow.setAttribute("rx", (66 * growth.sizeScale).toFixed(1));
  ambientGlow.setAttribute("ry", (88 * growth.sizeScale).toFixed(1));
  ambientGlow.setAttribute("fill", colorToCss(colorA, 0.1));
  ambientGlow.setAttribute("filter", `url(#${ambientFilterId})`);
  ambientGlow.classList.add("plant-ambient-glow");
  svg.appendChild(ambientGlow);

  const ground = document.createElementNS(SVG_NS, "ellipse");
  ground.setAttribute("cx", String(base.x));
  ground.setAttribute("cy", "465");
  ground.setAttribute("rx", (32 * growth.sizeScale).toFixed(1));
  ground.setAttribute("ry", (7 * growth.sizeScale).toFixed(1));
  ground.setAttribute("fill", colorToCss(colorA, 0.14));
  svg.appendChild(ground);

  // 새싹 (성장 애니메이션의 첫 단계)
  const seedDot = document.createElementNS(SVG_NS, "circle");
  seedDot.setAttribute("cx", String(base.x));
  seedDot.setAttribute("cy", String(base.y));
  seedDot.setAttribute("r", (4 + 3 * growth.sizeScale).toFixed(1));
  seedDot.setAttribute("fill", colorToCss(colorA, 0.9));
  seedDot.classList.add("plant-seed");
  svg.appendChild(seedDot);

  const { bloomPoints, leafPoints, tip } = GARDEN_TYPE_BUILDERS[typeIndex](ctx);

  drawGardenLeaves(ctx, leafPoints);
  assignAndDrawBlooms(ctx, bloomPoints);

  // 자라난 끝에서 아주 은은하게 퍼지는 빛
  if (tip) {
    const tipGlow = document.createElementNS(SVG_NS, "circle");
    tipGlow.setAttribute("cx", tip.x.toFixed(1));
    tipGlow.setAttribute("cy", tip.y.toFixed(1));
    tipGlow.setAttribute("r", (7 + 6 * growth.sizeScale).toFixed(1));
    tipGlow.setAttribute("fill", colorToCss(colorA, 0.5));
    tipGlow.setAttribute("filter", `url(#${tipFilterId})`);
    tipGlow.classList.add("plant-tip-glow");
    svg.appendChild(tipGlow);
  }

  if (animated) {
    return applyGrowthAnimation(svg, ctx.budCount > 0, ctx.openFlowerCount > 0);
  }
  return 0;
}

// 새싹은 이미 떠 있고, 줄기/가지는 "그려지는" 애니메이션으로, 잎→봉오리→꽃 순서로
// 그룹별 지연시간을 준다. 어떤 유형이 몇 개의 조각으로 식물을 만들었는지와 무관하게
// class로만 대상을 찾기 때문에(querySelectorAll) 6가지 유형 모두에 그대로 적용된다.
function applyGrowthAnimation(svg, hasBuds, hasFlowers) {
  const SKELETON_DELAY = 0.5;
  const SKELETON_DURATION = 1.05;
  const LEAF_DELAY = SKELETON_DELAY + SKELETON_DURATION - 0.15;

  svg.querySelectorAll(".plant-stem, .plant-branch").forEach((el) => {
    animateStrokeDraw(el, SKELETON_DELAY, SKELETON_DURATION);
  });

  svg.querySelectorAll(".plant-leaf").forEach((el, i) => {
    el.style.animationDelay = `${(LEAF_DELAY + i * 0.03).toFixed(2)}s`;
  });

  let cursor = LEAF_DELAY + LEAF_POP_DURATION;

  if (hasBuds) {
    const budDelay = cursor - 0.1;
    svg.querySelectorAll(".plant-bud").forEach((el, i) => {
      el.style.animationDelay = `${(budDelay + i * 0.05).toFixed(2)}s`;
    });
    cursor = budDelay + 0.55;
  }

  if (hasFlowers) {
    const flowerDelay = cursor - 0.05;
    svg.querySelectorAll(".plant-flower").forEach((el, i) => {
      el.style.animationDelay = `${(flowerDelay + i * 0.06).toFixed(2)}s`;
    });
    cursor = flowerDelay + FLOWER_BLOOM_DURATION;
  }

  const tipGlowDelay = cursor + 0.2;
  const tipGlow = svg.querySelector(".plant-tip-glow");
  if (tipGlow) {
    tipGlow.style.animationDelay = `${tipGlowDelay.toFixed(2)}s`;
  }

  return (tipGlowDelay + 0.6) * 1000; // ms — 결과 화면의 안내 문구가 뜨는 시점 계산에 쓰인다
}

function buildAndGrowPlant(elapsedSeconds, randomSeed) {
  const svg = document.getElementById("plantSvg");
  const plantInfo = document.getElementById("plantInfo");
  if (!svg) {
    return;
  }

  if (plantInfo) {
    plantInfo.classList.remove("is-visible");
  }

  const revealDelayMs = renderWildflowerPlant(svg, elapsedSeconds, randomSeed, true);

  if (growRevealTimeoutId !== null) {
    clearTimeout(growRevealTimeoutId);
  }
  growRevealTimeoutId = setTimeout(() => {
    if (plantInfo) {
      plantInfo.classList.add("is-visible");
    }
  }, revealDelayMs);
}

// 정원 화면을 저장된 데이터로부터 다시 그린다. 위의 정원 전용 야생화 시스템을 사용하므로
// (기존 결과 화면의 renderPlant와는 별개) 저장된 식물들도 항상 다양한 모습으로 그려진다.
function renderGardenScreen() {
  const container = document.getElementById("gardenPlants");
  if (!container) {
    return;
  }

  const plants = loadGardenPlants();

  const gardenBed = document.getElementById("gardenBed");
  const gardenEmpty = document.getElementById("gardenEmpty");
  const newTimeBtn = document.getElementById("newTimeBtn");
  const resetGardenBtn = document.getElementById("resetGardenBtn");
  const isEmpty = plants.length === 0;

  if (gardenBed) {
    gardenBed.hidden = isEmpty;
  }
  if (gardenEmpty) {
    gardenEmpty.hidden = !isEmpty;
  }
  if (newTimeBtn) {
    newTimeBtn.hidden = isEmpty;
  }
  if (resetGardenBtn) {
    // 정원이 이미 비어 있으면 초기화할 것이 없으므로 버튼을 숨긴다.
    resetGardenBtn.hidden = isEmpty;
  }

  container.innerHTML = "";

  plants.forEach((entry, index) => {
    // 땅에 심어진 기준선은 유지하되, 식물마다 좌우 위치/간격/크기에
    // 자연스러운 차이를 준다 (겹치지 않도록 간격을 줄이지 않고 늘리기만 한다).
    const jitterSeed = entry.elapsedSeconds + index * 7.13;
    const scaleJitter = 0.86 + 0.3 * hash01(jitterSeed + 1);
    const liftJitter = -5 + 10 * hash01(jitterSeed + 2);
    const marginLeft = 4 + 20 * hash01(jitterSeed + 3);
    const marginRight = 4 + 20 * hash01(jitterSeed + 4);

    const wrapper = document.createElement("div");
    wrapper.className = "garden-plant-slot";
    wrapper.style.margin = `0 ${marginRight.toFixed(1)}px 0 ${marginLeft.toFixed(1)}px`;
    wrapper.style.transform = `scale(${scaleJitter.toFixed(3)}) translateY(${liftJitter.toFixed(1)}px)`;

    const slot = document.createElement("div");
    slot.className = "garden-plant";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "garden-plant-svg");
    svg.setAttribute("viewBox", "0 0 400 480");
    svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
    svg.setAttribute("aria-hidden", "true");
    slot.appendChild(svg);

    const label = document.createElement("p");
    label.className = "garden-plant-label";
    label.textContent = plantLabelFor(index);
    slot.appendChild(label);

    wrapper.appendChild(slot);
    container.appendChild(wrapper);
    // 예전에 저장된 식물(개성 시드가 없는 데이터)도 문제없이 그려지도록 대체값을 준비해 둔다.
    const seed = entry.randomSeed !== undefined ? entry.randomSeed : entry.elapsedSeconds * 137.5;
    renderWildflowerPlant(svg, entry.elapsedSeconds, seed, false);
  });
}

function handlePlantToGarden() {
  // 결과 화면에서 방금 완성된 것과 정확히 같은 식물이 되도록, 새로운 값을 만들지 않고
  // 그 식물을 만든 (elapsedSeconds, randomSeed)를 그대로 저장한다.
  const plants = loadGardenPlants();
  plants.push({
    elapsedSeconds: lastElapsedSeconds,
    diffSeconds: lastDiffSeconds,
    randomSeed: lastRandomSeed,
    plantedAt: Date.now(),
  });
  saveGardenPlants(plants);

  renderGardenScreen();
  showScreen("garden");
}

// ---------- 다시 경험하기 ----------
function restartExperience() {
  if (growRevealTimeoutId !== null) {
    clearTimeout(growRevealTimeoutId);
    growRevealTimeoutId = null;
  }
  measureStartTime = null;
  showScreen("intro");
}

// ---------- 정원 초기화 확인 모달 ----------
const MODAL_TRANSITION_MS = 350;
let resetModalHideTimeoutId = null;

function openResetModal() {
  const overlay = document.getElementById("resetModalOverlay");
  if (!overlay) {
    return;
  }
  if (resetModalHideTimeoutId !== null) {
    clearTimeout(resetModalHideTimeoutId);
    resetModalHideTimeoutId = null;
  }
  overlay.hidden = false;
  // hidden을 막 푼 상태(opacity 0)가 먼저 한 프레임 그려지도록 한 뒤에 is-visible을 붙여야
  // opacity 트랜지션이 실제로 재생된다.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
    });
  });
}

function closeResetModal() {
  const overlay = document.getElementById("resetModalOverlay");
  if (!overlay) {
    return;
  }
  overlay.classList.remove("is-visible");
  resetModalHideTimeoutId = setTimeout(() => {
    overlay.hidden = true;
  }, MODAL_TRANSITION_MS);
}

function handleResetGardenConfirm() {
  clearGardenPlants();
  renderGardenScreen();
  closeResetModal();
}

document.addEventListener("DOMContentLoaded", () => {
  const particleContainer = document.getElementById("particles");
  if (particleContainer) {
    createParticles(particleContainer, 26);
  }

  const startBtn = document.getElementById("startBtn");
  const minuteBtn = document.getElementById("minuteBtn");
  const plantBtn = document.getElementById("plantBtn");
  const gardenBtn = document.getElementById("gardenBtn");
  const restartBtn = document.getElementById("restartBtn");
  const newTimeBtn = document.getElementById("newTimeBtn");
  const firstPlantBtn = document.getElementById("firstPlantBtn");
  const resetGardenBtn = document.getElementById("resetGardenBtn");
  const resetCancelBtn = document.getElementById("resetCancelBtn");
  const resetConfirmBtn = document.getElementById("resetConfirmBtn");
  const resetModalOverlay = document.getElementById("resetModalOverlay");

  if (startBtn) {
    startBtn.addEventListener("click", startMeasuring);
  }
  if (minuteBtn) {
    minuteBtn.addEventListener("click", finishMeasuring);
  }
  if (plantBtn) {
    plantBtn.addEventListener("click", goToGrowScreen);
  }
  if (gardenBtn) {
    gardenBtn.addEventListener("click", handlePlantToGarden);
  }
  if (restartBtn) {
    restartBtn.addEventListener("click", restartExperience);
  }
  if (newTimeBtn) {
    newTimeBtn.addEventListener("click", restartExperience);
  }
  if (firstPlantBtn) {
    firstPlantBtn.addEventListener("click", restartExperience);
  }
  if (resetGardenBtn) {
    resetGardenBtn.addEventListener("click", openResetModal);
  }
  if (resetCancelBtn) {
    resetCancelBtn.addEventListener("click", closeResetModal);
  }
  if (resetConfirmBtn) {
    resetConfirmBtn.addEventListener("click", handleResetGardenConfirm);
  }
  if (resetModalOverlay) {
    // 배경(카드 바깥) 클릭 시에도 취소와 같이 동작한다.
    resetModalOverlay.addEventListener("click", (event) => {
      if (event.target === resetModalOverlay) {
        closeResetModal();
      }
    });
  }

  renderGardenScreen();
});
