const MAX_PHOTO=400000;
function validatePhoto(bytes,type){const valid=type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||type==='image/png'&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);if(!valid||bytes.length<16)throw Object.assign(Error('Загрузите фото JPEG или PNG'),{status:400});if(bytes.length>MAX_PHOTO)throw Object.assign(Error('Фото слишком большое'),{status:413});return type==='image/png'?'png':'jpg'}
module.exports={validatePhoto,MAX_PHOTO};
