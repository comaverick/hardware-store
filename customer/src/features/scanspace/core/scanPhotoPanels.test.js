import { classifyFoldedPhotoPanels, protectFoldedPanelJunctions } from "./scanPhotoPanels";
import { classifyWallPhotoDetails } from "./scanWallPhotoDetails";

function panel({depth=true, shadows=false, horizontal=false}={}) {
  const cells=new Map();
  for(let y=0;y<65;y++) for(let x=0;x<60;x++) {
    const inside=x>=10&&x<50&&y>=5&&y<55;
    const wave=Math.cos((horizontal?y:x)*Math.PI/3);
    const value=inside ? shadows ? x<30 ? 70:215 : 140+70*wave : 230;
    cells.set(`${x},${y}`,{x,y,rgb:[value,value,value],depthOffset:depth && inside ? .035*wave : 0});
  }
  return cells;
}

test("tall repeated photographic pleats with measured folds keep the entire fabric region",()=>{
  const cells=panel();
  const raw=cells.get("25,30").rgb.slice();
  classifyWallPhotoDetails(cells,.04);
  expect(cells.get("25,30").foldedPanel).toBe(true);
  expect(cells.get("25,30").detail).toBe(true);
  expect(cells.get("35,30").foldedPanel).toBe(true);
  expect(cells.get("25,60").foldedPanel).toBe(false);
  expect(cells.get("2,30").foldedPanel).toBe(false);
  expect(cells.get("25,30").rgb).toEqual(raw);
});

test.each([{depth:false},{shadows:true},{horizontal:true}])("flat striped walls, a hard shadow and horizontal texture cannot become folded foreground (%s)",options=>{
  const cells=panel(options);
  classifyFoldedPhotoPanels(cells,.04);
  expect([...cells.values()].some(p=>p.foldedPanel)).toBe(false);
});

test("a small monochrome picture cannot authorize a tall fabric mask",()=>{
  const cells=panel();
  for(const p of cells.values()) if(p.y>20) p.rgb=[230,230,230];
  classifyFoldedPhotoPanels(cells,.04);
  expect([...cells.values()].some(p=>p.foldedPanel)).toBe(false);
});

test('cropped smooth cloth columns stay protected within the measured pleat envelope',()=>{
  const cells=panel();
  for(const p of cells.values()) {p.support=3;if(p.x>=12 && p.x<18 && p.y>=5 && p.y<18)p.rgb=[150,150,150];}
  classifyFoldedPhotoPanels(cells,.04);
  expect(cells.get('15,10').foldedPanel).toBe(true);
  expect(cells.get('15,60').foldedPanel).toBe(false);
  expect(cells.get('2,10').foldedPanel).toBe(false);
});

test('a neighboring wall protects a curtain edge while distant wall pixels stay editable',()=>{
  const cloth={wall:{normal:[0,0,1],offset:0,axes:[[1,0,0],[0,1,0]],cellSize:.04,
    extent:[[0,0],[2,2]],texture:{width:2,height:2},detailMask:new Uint8Array(4)},
    preserved:new Map([['1,0',{}],['1,1',{}]])};
  const adjacent={wall:{normal:[1,0,0],offset:.04,axes:[[0,0,1],[0,1,0]],cellSize:.04,
    extent:[[0,0],[2,2]],texture:{width:2,height:2},detailMask:new Uint8Array(4)},preserved:new Map()};
  const distant={...adjacent,wall:{...adjacent.wall,offset:.4,detailMask:new Uint8Array(4)}};
  expect(protectFoldedPanelJunctions([cloth,adjacent,distant]).protectedCurtainJunctionPixels).toBe(4);
  expect(adjacent.wall.detailMask.every(v=>v===255)).toBe(true);
  expect(distant.wall.detailMask.some(Boolean)).toBe(false);
  for(const c of cloth.preserved.values())c.rgb=[55,50,45];
  adjacent.wall.detailMask.fill(0);
  adjacent.wall.texture.data=new Uint8Array(16).fill(230);
  protectFoldedPanelJunctions([cloth,adjacent]);
  expect(adjacent.wall.detailMask.some(Boolean)).toBe(false);
  adjacent.wall.texture.data.fill(60);
  protectFoldedPanelJunctions([cloth,adjacent]);
  expect(adjacent.wall.detailMask.every(v=>v===255)).toBe(true);
  adjacent.wall.detailMask.fill(0);adjacent.wall.texture.data.fill(35);
  protectFoldedPanelJunctions([cloth,adjacent]);
  expect(adjacent.wall.detailMask.every(v=>v===255)).toBe(true);
});
