function transaction(db,fn){if(db.transaction)return db.transaction(fn);db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}
module.exports={transaction};
