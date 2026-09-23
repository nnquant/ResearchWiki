"""Read-only PDF naming evidence. No network or model calls; cache keyed by SHA-256."""
import json, sys, re, os
from pathlib import Path
import fitz
fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)

def extract(file):
    with fitz.open(file) as doc:
        pages=[]
        indices=set(range(min(4,len(doc)))) | set(range(max(0,len(doc)-2),len(doc)))
        for i in sorted(indices):
            p=doc[i]; text=p.get_text(); lines=[]
            if i<4:
                for b in p.get_text('dict')['blocks']:
                    for line in b.get('lines',[]):
                        s=''.join(x['text'] for x in line['spans']).strip()
                        if s: lines.append({'text':s,'size':round(max(x['size'] for x in line['spans']),2),'x':round(line['bbox'][0],1),'y':round(line['bbox'][1],1)})
            pages.append({'page':i+1,'text':text,'lines':lines})
        return {'pages':len(doc),'metadata':doc.metadata,'sample_pages':pages}

def main():
    if sys.argv[1]=='--file':
        print(json.dumps(extract(sys.argv[2]),ensure_ascii=False));return
    rows=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'));out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
    count=errors=0
    for row in rows:
        target=out/(row['sha256']+'.json')
        if target.exists():continue
        try:value=extract(row['raw_path'])
        except Exception as e:value={'error':str(e)};errors+=1
        temp=target.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');os.replace(temp,target);count+=1
        if count%250==0:print(json.dumps({'extracted':count,'errors':errors}),flush=True)
    print(json.dumps({'extracted':count,'errors':errors,'done':True}),flush=True)
if __name__=='__main__':main()
