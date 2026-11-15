
/* Verified Vegan — iPhone and Android barcode scanner */
(()=>{
'use strict';

const byId=id=>document.getElementById(id);
let scanner=null,starting=false,active=false,generation=0,loading=null;
const valid=v=>/^\d{8,14}$/.test(v);

function loadLibrary(){
  if(window.Html5Qrcode)return Promise.resolve();
  if(loading)return loading;

  loading=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload=()=>window.Html5Qrcode
      ?resolve()
      :reject(Error('Scanner library unavailable'));
    s.onerror=()=>reject(Error('Unable to load scanner library. Check your connection.'));
    document.head.appendChild(s);
  }).catch(e=>{
    loading=null;
    throw e;
  });

  return loading;
}

async function stop(){
  ++generation;
  active=false;
  starting=false;

  const old=scanner;
  scanner=null;

  if(old){
    try{await old.stop()}catch(e){}
    try{old.clear()}catch(e){}
  }

  const panel=byId('cameraPanel');
  const box=byId('vvUniversalScanner');

  if(box)box.style.display='none';
  if(panel)panel.style.display='none';

  const button=byId('startCamera');
  if(button){
    button.disabled=false;
    button.textContent='📷 Scan Barcode';
  }
}

async function start(){
  if(starting||active)return;

  if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext){
    alert('Camera scanning requires HTTPS and camera permission.');
    if(typeof toggleManualEntry==='function')toggleManualEntry(true);
    return;
  }

  starting=true;
  const id=++generation;
  const button=byId('startCamera');
  button.disabled=true;
  button.textContent='Opening camera…';

  const panel=byId('cameraPanel');
  let box=byId('vvUniversalScanner');

  if(!box){
    box=document.createElement('div');
    box.id='vvUniversalScanner';
    box.style.cssText='width:100%;min-height:220px;overflow:hidden;border-radius:12px;background:#111';
    byId('video').insertAdjacentElement('afterend',box);
  }

  byId('video').style.display='none';
  box.style.display='block';
  panel.style.display='block';

  byId('scannerFeedback').textContent='Allow camera access, then hold the barcode steady.';

  try{
    await loadLibrary();
    if(id!==generation)return;

    const formats=window.Html5QrcodeSupportedFormats;
    const config={verbose:false};

    if(formats){
      config.formatsToSupport=[
        formats.EAN_13,
        formats.EAN_8,
        formats.UPC_A,
        formats.UPC_E
      ];
    }

    const instance=new window.Html5Qrcode('vvUniversalScanner',config);
    scanner=instance;
    let found=false;

    const success=async decoded=>{
      if(found||id!==generation)return;

      const code=String(decoded||'').replace(/\D/g,'');
      if(!valid(code))return;

      found=true;
      byId('scannerFeedback').textContent='Barcode found: '+code;

      await stop();
      byId('barcode').value=code;

      try{
        await lookupProduct();
      }catch(e){
        const m=byId('lookupMessage');
        if(m)m.textContent='Lookup error: '+e.message;
      }
    };

    const settings={
      fps:10,
      qrbox:(w,h)=>({
        width:Math.max(100,Math.min(w-20,320)),
        height:Math.max(75,Math.min(h-20,160))
      })
    };

    try{
      await instance.start(
        {facingMode:'environment'},
        settings,
        success,
        ()=>{}
      );
    }catch(first){
      const cameras=await window.Html5Qrcode.getCameras();
      if(!cameras.length)throw first;

      const rear=cameras.find(c=>
        /back|rear|environment/i.test(c.label)
      )||cameras[cameras.length-1];

      await instance.start(rear.id,settings,success,()=>{});
    }

    if(id!==generation){
      try{await instance.stop()}catch(e){}
      return;
    }

    active=true;
    starting=false;
    button.disabled=false;
    button.textContent='📷 Scanner Running';

    byId('scannerFeedback').textContent='Hold the barcode steady in the camera view.';

  }catch(e){
    if(id===generation){
      await stop();
      alert('Camera scanner: '+e.message+' You can enter the barcode manually.');
    }
  }
}

function install(){
  const startButton=byId('startCamera');
  const stopButton=byId('stopCamera');
  const another=byId('scanAnother');

  if(!startButton||!stopButton||!another)return;

  startButton.onclick=async()=>{
    if(typeof savingContribution!=='undefined'&&savingContribution){
      alert('Wait for the cloud save to finish.');
      return;
    }

    await stop();

    if(typeof resetProductData==='function')resetProductData();
    if(typeof showScannerView==='function')showScannerView();
    if(typeof toggleManualEntry==='function')toggleManualEntry(false);

    await start();
  };

  stopButton.onclick=()=>{stop()};

  another.onclick=async()=>{
    if(typeof savingContribution!=='undefined'&&savingContribution){
      alert('Wait for the cloud save to finish.');
      return;
    }

    await stop();

    if(typeof resetProductData==='function')resetProductData();
    if(typeof showScannerView==='function')showScannerView();

    await start();
  };

  const manual=byId('manualToggle');
  manual.addEventListener('click',()=>{stop()});

  window.addEventListener('pagehide',()=>{stop()});

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&(active||starting)){
      stop();
    }
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',install);
}else{
  install();
}

})();
