#!/usr/bin/env python3
"""Reproduce the shipped parser assets. Downloads are maintenance-only, never part of analysis."""
import base64, hashlib, io, json, tarfile, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'packages/workspace/parsers'
PACKAGES = [
 ('tree-sitter-wasms','0.1.13','sha512-wT+cR6DwaIz80/vho3AvSF0N4txuNx/5bcRKoXouOfClpxh/qqrF4URNLQXbbt8MaAxeksZcZd1j8gcGjc+QxQ==', ['javascript','typescript','tsx','python','java','go','rust','ruby','php','c_sharp','c','kotlin','scala','html']),
 ('@repomix/tree-sitter-wasms','0.1.17','sha512-tc3HnFqdMF1pXhIMzG3aTaBDpIiHK2tPfn3fwqA6P3WTbHa+1EuuTubbKshvmN7xCHP5Ojz0/VW4R+XvR88KOw==',['swift','cpp']),
 ('tree-sitter-fsharp','0.0.1','sha512-1i/qG+wXzUwjypwIoWXWNoYm8+EUbWb6W0vl15UJ5PoApJt/iovE3wmM/aaftJc/WXZBT++gO2ksPMABXMye7Q==',['fsharp']),
 ('web-tree-sitter','0.25.10','sha512-Y09sF44/13XvgVKgO2cNDw5rGk6s26MgoZPXLESvMXeefBf7i6/73eFurre0IsTW6E14Y0ArIzhUMmjoc7xyzA==',[]),
]
OUT.mkdir(parents=True,exist_ok=True)
records=[]
upstreams={}
for name,version,integrity,languages in PACKAGES:
 meta=json.load(urllib.request.urlopen(f'https://registry.npmjs.org/{name}/{version}'))
 data=urllib.request.urlopen(meta['dist']['tarball']).read()
 if 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()!=integrity:raise SystemExit('Integrity mismatch: '+name)
 tar=tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')
 for language in languages or ['web-tree-sitter']:
  filename=f'tree-sitter-{language}.wasm' if languages else 'web-tree-sitter.wasm'
  sourcefile=filename if languages else 'tree-sitter.wasm'
  member=('package/'+sourcefile) if 'package/'+sourcefile in tar.getnames() else next(n for n in tar.getnames() if n.endswith('/'+sourcefile))
  content=tar.extractfile(member).read();(OUT/filename).write_bytes(content)
  upstream=None
  if languages and name in ['tree-sitter-wasms','@repomix/tree-sitter-wasms']:
   dependency='tree-sitter-'+({'tsx':'typescript','c_sharp':'c-sharp'}.get(language,language))
   version_range=meta['devDependencies'][dependency]
   upstream_key=dependency+'@'+version_range.lstrip('^~')
   if upstream_key not in upstreams:
    original=json.load(urllib.request.urlopen('https://registry.npmjs.org/'+dependency+'/'+version_range.lstrip('^~')))
    upstreams[upstream_key]=dict(package=dependency,declaredVersion=version_range,license=original.get('license'),repository=original.get('repository'))
    original_bytes=urllib.request.urlopen(original['dist']['tarball']).read()
    original_tar=tarfile.open(fileobj=io.BytesIO(original_bytes),mode='r:gz')
    for notice in original_tar.getnames():
     if Path(notice).name.upper() in ['LICENSE','LICENSE.MD','COPYING']:
      license_file=upstream_key.replace('/','-')+'-'+Path(notice).name
      (OUT/license_file).write_bytes(original_tar.extractfile(notice).read());upstreams[upstream_key]['notice']=license_file
   upstream=upstreams[upstream_key]
  records.append(dict(upstream=upstream,file=filename,package=name,version=version,integrity=integrity,sha256=hashlib.sha256(content).hexdigest(),license=meta.get('license'),repository=meta.get('repository')))
 for member in tar.getnames():
  if Path(member).name.upper() in ['LICENSE','LICENSE.MD','UNLICENSE','COPYING']:
   (OUT/(name.replace('/','-')+'-'+Path(member).name)).write_bytes(tar.extractfile(member).read())
(OUT/'manifest.json').write_text(json.dumps(dict(version=1,assets=list({r['file']:r for r in records}.values())),indent=2)+'\n')
print('Verified parser assets:',len(records))
