import { classifyFoldedPhotoPanels } from "./scanPhotoPanels";
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
