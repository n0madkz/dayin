const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const luminance=hex=>{const rgb=hex.match(/\w\w/g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
test('brand text pairs meet 4.5:1 and nested notices retain their explicit foreground',()=>{
const dark=luminance('9b143c'),yellow=luminance('ffd43b'),white=1;assert.ok((white+.05)/(dark+.05)>=4.5);assert.ok((yellow+.05)/(dark+.05)>=4.5);
const css=fs.readFileSync('dist/theme.css','utf8');assert.ok(css.includes('.notice,.notice p,.notice strong'));assert.ok(css.includes('.editorial,.editorial h2,.editorial p,.editorial .eyebrow{color:var(--navy)}'));assert.ok(css.includes('.cuisine-chip.selected:hover{background:var(--navy);color:var(--white)}'));
});
