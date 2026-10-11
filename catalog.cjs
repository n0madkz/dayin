const CUISINES=['Европейская','Итальянская','Азиатская','Казахская','Грузинская','Узбекская','Турецкая','Японская','Корейская','Китайская','Индийская','Кофейни'];
function catalogPage(db,params,user){
 const limit=Math.min(48,Math.max(1,Number(params.get('limit'))||24)),cursor=params.get('cursor')||'',clauses=[],args=[];
 if(user?.role==='owner'){clauses.push('id=?');args.push(user.restaurant)}else if(user?.role!=='admin')clauses.push("json_extract(payload,'$.status')='active' AND json_extract(payload,'$.deleteAt') IS NULL");
 if(params.get('certificates')==='1')clauses.push("json_extract(payload,'$.halal') IS NOT NULL");
 const query=(params.get('query')||'').trim().slice(0,100);if(query){clauses.push("(json_extract(payload,'$.name') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.desc') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.cuisines') LIKE ? ESCAPE '\\')");const match='%'+query.replace(/[\\%_]/g,'\\$&')+'%';args.push(match,match,match)}
 const cuisines=params.getAll('cuisine').filter(c=>CUISINES.includes(c));if(cuisines.length){clauses.push(`EXISTS(SELECT 1 FROM json_each(json_extract(payload,'$.cuisines')) WHERE value IN (${cuisines.map(()=>'?').join(',')}))`);args.push(...cuisines)}
 if(params.get('halal')==='1'){clauses.push("json_extract(payload,'$.halal.status')='verified' AND json_extract(payload,'$.halal.validUntil')>=?");args.push(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bishkek'}))}
 const ids=(params.get('ids')||'').split(',').filter(Boolean).slice(0,100);if(ids.length){clauses.push(`id IN (${ids.map(()=>'?').join(',')})`);args.push(...ids)}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'',total=db.prepare('SELECT COUNT(*) AS n FROM restaurants'+where).get(...args).n;
 const after=cursor?(where?' AND ':' WHERE ')+'id>?':'',rows=db.prepare('SELECT payload FROM restaurants'+where+after+' ORDER BY id LIMIT ?').all(...args,...(cursor?[cursor]:[]),limit+1);
 const restaurants=rows.slice(0,limit).map(row=>JSON.parse(row.payload));return {restaurants,menus:{},cuisines:CUISINES,total,nextCursor:rows.length>limit?restaurants.at(-1).id:null,limit};
}
module.exports={catalogPage};
