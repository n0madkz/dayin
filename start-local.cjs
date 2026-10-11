const {createApp}=require('./server.cjs');
const port=Number(process.env.PORT||4173);
createApp({localMail:true,port,origin:`http://127.0.0.1:${port}`}).then(app=>app.server.listen(port,'127.0.0.1',()=>console.log(`Dayin: ${app.origin}\nЛокальная почта: ${app.origin}/dev/mail`))).catch(error=>{console.error(error.message);process.exitCode=1});
