const RETENTION_MS=7*24*60*60*1000;
function purgeDueRestaurants(db,now=Date.now()){
 const due=db.prepare('SELECT id,payload FROM restaurants').all().filter(row=>{const r=JSON.parse(row.payload);return Number.isFinite(r.deleteAt)&&r.deleteAt<=now});
 if(!due.length)return 0;
 db.exec('BEGIN IMMEDIATE');
 try{for(const {id} of due){
  db.prepare('DELETE FROM sessions WHERE user IN (SELECT id FROM users WHERE restaurant=?)').run(id);
  db.prepare('DELETE FROM mailbox WHERE recipient IN (SELECT email FROM users WHERE restaurant=?)').run(id);
  db.prepare('DELETE FROM users WHERE restaurant=?').run(id);
  db.prepare('DELETE FROM records WHERE restaurant=?').run(id);
  db.prepare('DELETE FROM menus WHERE restaurant=?').run(id);
  db.prepare('DELETE FROM restaurants WHERE id=?').run(id);
 }db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
 return due.length;
}
module.exports={RETENTION_MS,purgeDueRestaurants};
