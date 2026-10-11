#!/usr/bin/env python3
"""Build reconstructed Native with byte-identical v1.5.11 DEX, without CI/push."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import zipfile

BASE_SHA = '4e562d1521fc7027a599554d0b92a9bca948dd4e76bc36ee77c7d5c800bcfee6'

def run(args):
    subprocess.run([str(a) for a in args],check=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-apk',type=Path,required=True)
    p.add_argument('--sdk',type=Path,required=True)
    p.add_argument('--ndk',type=Path,required=True)
    p.add_argument('--keystore',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(); root=Path(__file__).resolve().parent
    if hashlib.sha256(a.base_apk.read_bytes()).hexdigest()!=BASE_SHA:
        p.error('The exact recovered v1.5.11 APK is required; DEX is not reconstructed from decompiler output.')
    out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
    tools=a.sdk.resolve()/'build-tools'/'android-15'
    if not tools.exists():tools=a.sdk.resolve()/'build-tools'/'35.0.1'
    platform=a.sdk.resolve()/'platforms'/'android-35'/'android.jar'
    if not platform.exists():platform=a.sdk.resolve()/'platforms'/'android-35'/'android.jar'
    compiler=a.ndk.resolve()/'toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android23-clang++'
    library=out/'libgakumas_progress_capture.so'
    run([compiler,'-std=c++17','-O2','-fPIC','-fvisibility=hidden','-ffunction-sections','-fdata-sections',
         '-shared','-static-libstdc++','-Wl,--gc-sections','-Wl,--build-id=sha1',root/'src/main/cpp/progress_capture.cpp','-ldl','-llog','-o',library])
    base=out/'manifest.apk'; unsigned=out/'unsigned.apk'; aligned=out/'aligned.apk'
    run([tools/'aapt2','link','-I',platform,'--manifest',root/'AndroidManifest.xml',
         '--min-sdk-version','23','--target-sdk-version','35','-o',base])
    with zipfile.ZipFile(a.base_apk) as old,zipfile.ZipFile(base) as manifest,zipfile.ZipFile(unsigned,'w') as z:
        for name in manifest.namelist():z.writestr(name,manifest.read(name),compress_type=zipfile.ZIP_DEFLATED)
        for name in old.namelist():
            if name=='classes.dex' or name.startswith('META-INF/xposed/'):
                z.writestr(name,old.read(name),compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('lib/arm64-v8a/libgakumas_progress_capture.so',library.read_bytes(),compress_type=zipfile.ZIP_STORED)
    run([tools/'zipalign','-P','16','-f','4',unsigned,aligned])
    key=a.keystore.resolve();key.parent.mkdir(parents=True,exist_ok=True)
    if not key.exists():
        run(['keytool','-genkeypair','-keystore',key,'-storepass','android','-keypass','android',
             '-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000',
             '-dname','CN=Gakumas Progress Capture Recovery,O=atuy1219,C=JP'])
    final=out/'gakumas-progress-capture-v1.5.12.apk'
    run([tools/'apksigner','sign','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android',
         '--ks-key-alias','androiddebugkey','--out',final,aligned])
    run([tools/'apksigner','verify','--verbose','--print-certs',final])
    run([tools/'zipalign','-c','-P','16','4',final])
    with zipfile.ZipFile(a.base_apk) as old,zipfile.ZipFile(final) as new:
        assert old.read('classes.dex')==new.read('classes.dex')
        assert new.getinfo('lib/arm64-v8a/libgakumas_progress_capture.so').compress_type==zipfile.ZIP_STORED
        for name in old.namelist():
            if name.startswith('META-INF/xposed/'):assert old.read(name)==new.read(name)
        dex=hashlib.sha256(new.read('classes.dex')).hexdigest()
    record=dict(versionName='1.5.12',versionCode=35,scope='local-validation-only',onDeviceVerified=False,
                githubPushed=False,ciRun=False,baseApkSha256=BASE_SHA,
                apkSha256=hashlib.sha256(final.read_bytes()).hexdigest(),bytes=final.stat().st_size,
                nativeSha256=hashlib.sha256(library.read_bytes()).hexdigest(),dexSha256=dex,dexByteIdenticalTo='1.5.11',
                maskConfigurationRewritten=False,existingMaskToRetain=7808,
                signingKey='new-recovery-key; original key not recovered',signatureVerificationPassed=True,
                zipAlign16KiBPassed=True,gameCaptureVerified=False,rootCompletionVerified=False,rngCaptured=False)
    (out/'build-verification.json').write_text(json.dumps(record,indent=2)+'\n')
    print(final)
if __name__=='__main__':main()
