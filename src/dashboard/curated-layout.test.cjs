const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const start=html.indexOf('const columnsForWidth=');
const end=html.indexOf('const ALL=',start);
assert.ok(start>=0&&end>start,'curated layout helpers must be extractable');
const api=vm.runInNewContext(html.slice(start,end)+';({columnsForWidth,curatedTileSize,CURATED_TILE_LAYOUT,DEFSIZE,clampTileSizes})');
const plain=value=>JSON.parse(JSON.stringify(value));

test('every existing dashboard tile has one authored composition',()=>{
  const ids=['goals','habits','breathing','health','shopping','agenda','events','note','weather','timer','worth','word','music','spanish','world','recall','pushups','weekly','birthdays','brain','brainflex','academic','gmat','philo','people'];
  assert.deepEqual(Object.keys(api.CURATED_TILE_LAYOUT),ids);
  for(const id of ids){
    for(const width of [320,375,390,639,640,768,999,1000,1440,2560]){
      const cols=api.columnsForWidth(width),size=api.curatedTileSize(id,cols);
      assert.ok(Number.isInteger(size.c)&&size.c>=1&&size.c<=cols,id+' must fit '+width+'px');
      assert.ok(Number.isInteger(size.r)&&size.r>=1,id+' needs a usable height');
      assert.ok(size.family,id+' needs an authored family');
    }
  }
});

test('phone families retain compact squares, wide cards and large cards',()=>{
  assert.deepEqual(plain(api.curatedTileSize('pushups',2)),{c:1,r:1,family:'small'});
  assert.deepEqual(plain(api.curatedTileSize('music',2)),{c:2,r:1,family:'wide'});
  assert.deepEqual(plain(api.curatedTileSize('goals',2)),{c:2,r:2,family:'large'});
  assert.equal(api.curatedTileSize('habits',2).c,2,'daily habit actions retain full phone width');
});

test('Events remains a large square while Philosophy stays wide',()=>{
  for(const cols of [1,2,4,6,8,12]){
    const events=api.curatedTileSize('events',cols);
    assert.equal(events.c,events.r,'countdown square at '+cols+' columns');
  }
  assert.deepEqual(plain(api.curatedTileSize('events',6)),{c:4,r:4,family:'large-square'});
  assert.deepEqual(plain(api.curatedTileSize('philo',6)),{c:4,r:2,family:'wide'});
  assert.deepEqual(plain(api.curatedTileSize('philo',2)),{c:2,r:1,family:'wide'});
});

test('browser zoom reflows into fewer columns instead of scaling text down',()=>{
  const columns=[1,1.5,2,4].map(zoom=>api.columnsForWidth(1280/zoom));
  assert.deepEqual(plain(columns),[12,4,4,1]);
  for(const cols of columns){
    for(const id of Object.keys(api.CURATED_TILE_LAYOUT))assert.ok(api.curatedTileSize(id,cols).c<=cols);
  }
  assert.equal(api.columnsForWidth(359),1);
  assert.equal(api.columnsForWidth(360),2);
});

test('legacy arbitrary dimensions neither drive rendering nor mutate saved data',()=>{
  const legacy={events:{c:1,r:6},philo:{c:6,r:1}},before=JSON.stringify(legacy);
  const curated=api.clampTileSizes(legacy,6);
  assert.equal(JSON.stringify(legacy),before);
  assert.deepEqual(plain(curated.events),{c:4,r:4,family:'large-square'});
  assert.deepEqual(plain(curated.philo),{c:4,r:2,family:'wide'});
  assert.match(html,/const sz=id=>curatedTileSize\(id,cols\)/);
  const initializer=html.slice(html.indexOf('const [sizes,setSizes]'),html.indexOf('const [activeTiles,setActiveTiles]'));
  assert.match(initializer,/load\("sizes",\{\}\)/);
  assert.doesNotMatch(initializer,/save\(/,'opening the dashboard must preserve old dimensions');
});

test('curated grid allows content growth and keeps modal content outside its sizing rules',()=>{
  const css=html.slice(html.indexOf('/* Curated responsive compositions */'),html.indexOf('/* Expanded cards retain'));
  assert.match(css,/grid-auto-rows:var\(--dashboard-unit\)/);
  assert.match(html,/new ResizeObserver\(measure\)/,"individual cards reserve extra grid rows when content grows");
  assert.match(css,/grid-auto-flow:row!important/,'visual order follows stored order');
  assert.match(css,/\.grid>\.tile\[data-tileid\]>\.tbody\{[^}]*overflow:visible!important/);
  assert.match(css,/body\[data-display="compact"\]/);
  assert.match(css,/body\[data-display="roomy"\]/);
  assert.doesNotMatch(css,/(?:^|[;{])\s*(?:zoom|transform):/,'browser zoom must not be counteracted');
  assert.doesNotMatch(css,/\.tileFocus/,'expanded content must not inherit grid dimensions');
});
