import { classifyWallPhotoDetails, wallPhotoTextureDetail } from "./scanWallPhotoDetails";

const srgb = value => Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
const paint = [.75, .65, .5];
const lit = paint.map(srgb);
const shadow = paint.map(value => srgb(value * .12));
const grid = color => new Map(Array.from({ length: 400 }, (_, i) => {
  const x = i % 20, y = Math.floor(i / 20);
  return [`${x},${y}`, { x, y, rgb: color(x, y), detail: true }];
}));

test("deep shadows, hard shadow edges and smooth gradients remain part of a warm wall", () => {
  for (const color of [
    (x, y) => x < 8 ? shadow : lit,
    (x, y) => paint.map(value => srgb(value * (.1 + .9 * x / 19))),
    (x, y) => x > 5 && x < 12 && y > 5 && y < 12 ? shadow : lit,
  ]) {
    const cells = grid(color);
    classifyWallPhotoDetails(cells, .04);
    expect([...cells.values()].some(p => p.detail)).toBe(false);
  }
});

test("consistent shallow depth bias cannot turn a colored wall and its shadows into photo details", () => {
  const color = [.08, .25, .14];
  const cells = grid((x, y) => color.map(value => srgb(value * (x < 8 ? .2 : 1))));
  for (const p of cells.values()) { p.foreground = true; p.foregroundOffset = .06; }
  classifyWallPhotoDetails(cells, .04);
  expect([...cells.values()].some(p => p.detail)).toBe(false);
});

test("a protected picture keeps enclosed pale highlights without protecting surrounding wall", () => {
  const cells = grid((x, y) => x >= 6 && x <= 12 && y >= 6 && y <= 12 &&
    !(x === 9 && y === 9) ? [20, 35, 80] : lit);
  classifyWallPhotoDetails(cells, .04);
  expect(cells.get("9,9").detail).toBe(true);
  expect(cells.get("5,9").detail).toBe(false);
  expect(cells.get("13,9").detail).toBe(false);
});

test("an irregular object's bounding box cannot protect bare wall or its shadow", () => {
  const cells = grid((x, y) => (x === 6 && y >= 5 && y <= 12) ||
    (y === 12 && x >= 6 && x <= 13) ? [20, 35, 80] :
    x >= 7 && x <= 12 && y >= 6 && y <= 11 ? shadow : lit);
  classifyWallPhotoDetails(cells, .04);
  expect(cells.get("6,9").detail).toBe(true);
  expect(cells.get("9,9").detail).toBe(false);
});

test("observed picture boundaries protect a neutral background anchored by photographic detail", () => {
  const cells = grid((x, y) => x >= 6 && x <= 12 && y >= 6 && y <= 12
    ? x === 6 || x === 12 ? [20, 35, 80] : [50, 50, 50] : lit);
  classifyWallPhotoDetails(cells, .04);
  expect(cells.get("9,9").detail).toBe(true);
  expect(cells.get("5,9").detail).toBe(false);
});

test("photographic texture and substantial measured relief still protect neutral objects", () => {
  const stripe = Array.from({ length: 9 }, (_, i) => i % 3 === 1 ? [230, 230, 230] : [30, 30, 30]);
  expect(wallPhotoTextureDetail(stripe)).toBe(true);
  expect(wallPhotoTextureDetail(Array.from({ length: 9 }, (_, i) => i % 3 === 0 ? shadow : lit))).toBe(false);
  expect(wallPhotoTextureDetail([null])).toBe(false);
  const cells = grid(() => lit);
  cells.get("9,9").textureDetail = wallPhotoTextureDetail(stripe);
  cells.get("10,10").foreground = true;
  cells.get("10,10").foregroundOffset = .12;
  cells.get("11,11").foreground = true;
  cells.get("11,11").foregroundOffset = .06;
  cells.get("11,11").rgb = shadow;
  classifyWallPhotoDetails(cells, .04);
  expect(cells.get("9,9").detail).toBe(true);
  expect(cells.get("10,10").detail).toBe(true);
  expect(cells.get("11,11").detail).toBe(false);
});

test("a framed picture with disconnected flowers and glare stays protected as a whole",()=>{
  const cells=new Map();
  for(let y=0;y<40;y++)for(let x=0;x<45;x++) {
    const picture=x>=8&&x<=35&&y>=8&&y<=30;
    const border=picture&&(x===8||x===35||y===8||y===30);
    const glare=picture&&x>18&&x<26&&y>14&&y<21;
    cells.set(`${x},${y}`,{x,y,rgb:picture ? border ? [150,110,45] : glare ? lit :
      (x+y)%7===0 ? [220,180,50] : [50,55,65] : lit,
      photoFrame:{frameId:1},textureDetail:border});
  }
  classifyWallPhotoDetails(cells,.04);
  expect(cells.get("22,18").detail).toBe(true);
  expect(cells.get("12,20").framedPicture).toBe(true);
  expect(cells.get("7,20").detail).toBe(false);
  expect(cells.get("36,20").detail).toBe(false);
});
test("depth-only bumps on a photographed blank wall cannot become artwork anchors",()=>{
  const cells=grid(()=>lit);
  for(const p of cells.values()){p.photoFrame={frameId:1};p.foreground=true;p.foregroundOffset=.12;}
  classifyWallPhotoDetails(cells,.04);
  expect([...cells.values()].some(p=>p.detail)).toBe(false);
});
