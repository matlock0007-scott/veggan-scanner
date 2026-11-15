
/* Verified Vegan — Improved Android and iPhone Barcode Scanner
   Native BarcodeDetector first, html5-qrcode fallback.
   Works with the existing Verified Vegan index.html.
*/

(()=>{
'use strict';

const $=id=>document.getElementById(id);

let scanner=null;
let stream=null;
let detector=null;
let active=false;
let starting=false;
let generation=0;
let loading=null;
let scanTimer=null;
let detectionBusy=false;
let found=false;
let scannerMode='';
let lastCandidate='';
let candidateCount=0;

const FORMATS=[
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e'
];

function validBarcode(value){
  return /^\d{8,14}$/.test(String(value||''));
}

function normalizeCode(value){
  return String(value||'').replace(/\D/g,'');
}

function feedback(message){
  const element=$('scannerFeedback');
  if(element)element.textContent=message;
}

function setButton(running=false,opening=false){
  const button=$('startCamera');
  if(!button)return;

  button.disabled=opening;
  button.textContent=opening
    ?'Opening camera…'
    :running
      ?'📷 Scanner Running'
      :'📷 Scan Barcode';
}

function showPanel(){
  const panel=$('cameraPanel');
  if(panel)panel.style.display='block';
}

function hidePanel(){
  const panel=$('cameraPanel');
  if(panel)panel.style.display='none';
}

function scannerBox(){
  let box=$('vvUniversalScanner');

  if(!box){
    box=document.createElement('div');
    box.id='vvUniversalScanner';

    box.style.cssText=[
      'width:100%',
      'min-height:220px',
      'overflow:hidden',
      'border-radius:12px',
      'background:#111',
      'position:relative'
    ].join(';');

    $('video').insertAdjacentElement('afterend',box);
  }

  return box;
}

function clearTimer(){
  if(scanTimer!==null){
    clearTimeout(scanTimer);
    scanTimer=null;
  }
}

async function stop(){
  ++generation;

  active=false;
  starting=false;
  detectionBusy=false;
  found=false;

  lastCandidate='';
  candidateCount=0;

  clearTimer();

  const oldScanner=scanner;
  const oldStream=stream;

  scanner=null;
  stream=null;
  detector=null;

  const video=$('video');

  if(video){
    try{video.pause()}catch(e){}
    video.srcObject=null;
    video.style.display='none';
  }

  if(oldStream){
    for(const track of oldStream.getTracks()){
      try{track.stop()}catch(e){}
    }
  }

  if(oldScanner){
    try{await oldScanner.stop()}catch(e){}
    try{oldScanner.clear()}catch(e){}
  }

  const box=$('vvUniversalScanner');
  if(box)box.style.display='none';

  hidePanel();
  setButton(false);
  scannerMode='';
}

function loadLibrary(){
  if(window.Html5Qrcode)return Promise.resolve();

  if(loading)return loading;

  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');

    script.src=
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

    script.onload=()=>{
      if(window.Html5Qrcode)resolve();
      else reject(Error('Scanner library unavailable.'));
    };

    script.onerror=()=>{
      reject(Error('Unable to load scanner library.'));
    };

    document.head.appendChild(script);
  }).catch(error=>{
    loading=null;
    throw error;
  });

  return loading;
}

/* Camera focus and zoom */

async function improveCamera(track){
  if(!track)return;

  try{
    const capabilities=track.getCapabilities?.()||{};
    const advanced={};

    if(Array.isArray(capabilities.focusMode)){
      if(capabilities.focusMode.includes('continuous')){
        advanced.focusMode='continuous';
      }else if(capabilities.focusMode.includes('auto')){
        advanced.focusMode='auto';
      }
    }

    if(
      capabilities.zoom &&
      typeof capabilities.zoom.min==='number'
    ){
      const minimum=capabilities.zoom.min;
      const maximum=capabilities.zoom.max;

      // Avoid excessive zoom, which makes close barcodes blurry.
      const desired=Math.max(
        minimum,
        Math.min(maximum,1.5)
      );

      advanced.zoom=desired;
    }

    if(Object.keys(advanced).length){
      try{
        await track.applyConstraints({
          advanced:[advanced]
        });
      }catch(e){
        // Unsupported camera controls must not stop scanning.
      }
    }
  }catch(e){}
}

/* Validate and accept barcode */

async function acceptBarcode(value,id){
  if(!active||found||id!==generation)return;

  const code=normalizeCode(value);

  if(!validBarcode(code))return;

  // Require a repeated detection for reliability.
  if(code===lastCandidate){
    candidateCount++;
  }else{
    lastCandidate=code;
    candidateCount=1;
  }

  if(candidateCount<2)return;

  found=true;

  feedback('Barcode found: '+code);

  await stop();

  const input=$('barcode');
  if(input)input.value=code;

  try{
    if(typeof lookupProduct==='function'){
      await lookupProduct();
    }else{
      throw Error('Product lookup is unavailable.');
    }
  }catch(error){
    const message=$('lookupMessage');
    if(message){
      message.textContent='Lookup error: '+error.message;
    }
  }
}

/* Native scanner — preferred on supported Android browsers */

async function startNative(id){
  if(!('BarcodeDetector' in window)){
    throw Error('Native barcode detection unavailable.');
  }

  const supported=
    typeof BarcodeDetector.getSupportedFormats==='function'
      ?await BarcodeDetector.getSupportedFormats()
      :FORMATS;

  const formats=FORMATS.filter(format=>
    supported.includes(format)
  );

  if(!formats.length){
    throw Error('No supported native barcode formats.');
  }

  detector=new BarcodeDetector({formats});

  const constraints={
    audio:false,
    video:{
      facingMode:{ideal:'environment'},
      width:{ideal:1280},
      height:{ideal:720},
      frameRate:{ideal:30}
    }
  };

  let cameraStream;

  try{
    cameraStream=await navigator.mediaDevices.getUserMedia(
      constraints
    );
  }catch(error){
    // Retry with simple constraints for devices that reject
    // the preferred resolution or camera settings.
    cameraStream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:'environment'}
    });
  }

  if(id!==generation){
    cameraStream.getTracks().forEach(track=>track.stop());
    return;
  }

  stream=cameraStream;

  const video=$('video');
  const box=scannerBox();

  box.style.display='none';
  video.style.display='block';

  video.setAttribute('playsinline','');
  video.muted=true;
  video.autoplay=true;
  video.srcObject=stream;

  showPanel();

  await video.play();

  if(id!==generation)return;

  const track=stream.getVideoTracks()[0];

  await improveCamera(track);

  if(id!==generation)return;

  scannerMode='native';
  active=true;
  starting=false;

  setButton(true);

  feedback(
    'Point at the barcode. Keep it sharp and inside the camera view.'
  );

  async function scanFrame(){
    if(
      !active ||
      found ||
      id!==generation ||
      scannerMode!=='native'
    )return;

    if(detectionBusy){
      scanTimer=setTimeout(scanFrame,100);
      return;
    }

    detectionBusy=true;

    try{
      if(video.readyState>=2){
        const results=await detector.detect(video);

        if(!active||id!==generation)return;

        for(const result of results){
          const code=normalizeCode(result.rawValue);

          if(validBarcode(code)){
            await acceptBarcode(code,id);

            if(found||id!==generation)return;
          }
        }

        if(!results.length){
          lastCandidate='';
          candidateCount=0;
        }
      }
    }catch(error){
      // A single failed frame should not shut down the camera.
    }finally{
      detectionBusy=false;
    }

    if(active&&id===generation){
      scanTimer=setTimeout(scanFrame,100);
    }
  }

  scanFrame();
}

/* Cross-platform fallback — iPhone and other browsers */

async function startFallback(id){
  await loadLibrary();

  if(id!==generation)return;

  const box=scannerBox();
  const video=$('video');

  video.style.display='none';
  box.style.display='block';

  showPanel();

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

  const instance=new window.Html5Qrcode(
    'vvUniversalScanner',
    config
  );

  scanner=instance;

  const success=decoded=>{
    if(!active||found||id!==generation)return;

    acceptBarcode(decoded,id).catch(error=>{
      console.warn('Barcode processing:',error);
    });
  };

  // A larger detection area makes it easier to find
  // barcodes without holding them at an exact distance.
  const settings={
    fps:15,
    qrbox:(width,height)=>{
      const availableWidth=Math.max(100,width-12);
      const availableHeight=Math.max(80,height-12);

      return {
        width:Math.min(
          availableWidth,
          Math.max(100,Math.round(width*.90))
        ),
        height:Math.min(
          availableHeight,
          Math.max(80,Math.round(height*.65))
        )
      };
    },
    aspectRatio:1.777778,
    disableFlip:true
  };

  let started=false;

  try{
    await instance.start(
      {facingMode:'environment'},
      settings,
      success,
      ()=>{}
    );

    started=true;
  }catch(firstError){
    if(id!==generation)return;

    const cameras=await window.Html5Qrcode.getCameras();

    if(!cameras.length)throw firstError;

    const rear=cameras.find(camera=>
      /back|rear|environment/i.test(camera.label)
    )||cameras[cameras.length-1];

    await instance.start(
      rear.id,
      settings,
      success,
      ()=>{}
    );

    started=true;
  }

  if(id!==generation){
    if(started){
      try{await instance.stop()}catch(e){}
    }
    return;
  }

  scannerMode='fallback';
  active=true;
  starting=false;

  setButton(true);

  feedback(
    'Hold the barcode steady. Move slightly farther away if blurry.'
  );

  // Apply supported focus controls to the fallback camera.
  try{
    const capabilities=instance.getRunningTrackCapabilities?.();
    const advanced={};

    if(
      capabilities?.focusMode?.includes?.('continuous')
    ){
      advanced.focusMode='continuous';
    }

    if(
      capabilities?.zoom &&
      typeof capabilities.zoom.min==='number'
    ){
      advanced.zoom=Math.max(
        capabilities.zoom.min,
        Math.min(capabilities.zoom.max,1.5)
      );
    }

    if(Object.keys(advanced).length){
      await instance.applyVideoConstraints({
        advanced:[advanced]
      });
    }
  }catch(e){}
}

/* Scanner startup */

async function start(){
  if(starting||active)return;

  if(
    !navigator.mediaDevices?.getUserMedia ||
    !window.isSecureContext
  ){
    alert(
      'Camera scanning requires HTTPS and camera permission.'
    );

    if(typeof toggleManualEntry==='function'){
      toggleManualEntry(true);
    }

    return;
  }

  starting=true;

  const id=++generation;

  setButton(false,true);
  feedback('Opening camera…');

  try{
    let nativeWorked=false;

    if('BarcodeDetector' in window){
      try{
        await startNative(id);
        nativeWorked=active;
      }catch(error){
        console.warn(
          'Native scanner unavailable, trying fallback:',
          error
        );

        if(stream){
          stream.getTracks().forEach(track=>{
            try{track.stop()}catch(e){}
          });
          stream=null;
        }

        const video=$('video');

        try{video.pause()}catch(e){}
        video.srcObject=null;
      }
    }

    if(id!==generation)return;

    if(!nativeWorked){
      feedback('Starting compatible barcode scanner…');
      await startFallback(id);
    }

  }catch(error){
    if(id!==generation)return;

    await stop();

    alert(
      'Camera scanner: '+error.message+
      ' You can enter the barcode manually.'
    );
  }finally{
    if(id===generation){
      starting=false;
      setButton(active);
    }
  }
}

/* Connect scanner to the existing Verified Vegan app */

function install(){
  const startButton=$('startCamera');
  const stopButton=$('stopCamera');
  const anotherButton=$('scanAnother');
  const manualButton=$('manualToggle');

  if(!startButton||!stopButton||!anotherButton)return;

  async function beginNewScan(){
    if(
      typeof savingContribution!=='undefined' &&
      savingContribution
    ){
      alert('Wait for the cloud save to finish.');
      return;
    }

    await stop();

    if(typeof resetProductData==='function'){
      resetProductData();
    }

    if(typeof showScannerView==='function'){
      showScannerView();
    }

    if(typeof toggleManualEntry==='function'){
      toggleManualEntry(false);
    }

    await start();
  }

  startButton.onclick=beginNewScan;
  anotherButton.onclick=beginNewScan;

  stopButton.onclick=()=>{
    stop();
  };

  if(manualButton){
    manualButton.addEventListener('click',()=>{
      stop();
    });
  }

  window.addEventListener('pagehide',()=>{
    stop();
  });

  document.addEventListener('visibilitychange',()=>{
    if(
      document.visibilityState==='hidden' &&
      (active||starting)
    ){
      stop();
    }
  });

  // Make the original index.html stopCamera() call
  // stop this scanner too, including when lookupProduct()
  // or showProductView() changes screens.
  const originalStop=window.stopCamera;

  window.stopCamera=function(){
    if(typeof originalStop==='function'){
      try{originalStop()}catch(e){}
    }

    stop();
  };
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',install);
}else{
  install();
}

})();
