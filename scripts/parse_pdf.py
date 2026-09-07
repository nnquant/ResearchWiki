"""MinerU direct parsing avoids Windows CLI temporary-path length limits."""
import argparse
import json
import os
from pathlib import Path

def source_path(value):
    source = Path(value).absolute()
    # Node can archive exact NTFS names ending in a dot; Win32 normalizes them.
    if os.name == 'nt' and not str(source).startswith('\\\\?\\'):
        return Path('\\\\?\\' + str(source))
    return source

def page_markdown(output):
    from mineru.backend.pipeline.pipeline_middle_json_mkcontent import union_make
    from mineru.utils.enum_class import MakeMode
    middle_files = list(output.rglob('*_middle.json'))
    if len(middle_files) != 1:
        raise ValueError(f'Expected one MinerU middle JSON, found {len(middle_files)}')
    middle_path = middle_files[0]
    middle = json.loads(middle_path.read_text(encoding='utf-8'))
    sections = []
    for page in middle['pdf_info']:
        content = union_make([page], MakeMode.MM_MD, 'images')
        sections.append(f'## PDF 第 {page["page_idx"] + 1} 页\n\n{content}')
    (middle_path.parent / 'pages.md').write_text('\n\n'.join(sections), encoding='utf-8')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--backend', default='pipeline')
    parser.add_argument('--pages-only', action='store_true')
    args = parser.parse_args()
    os.environ['MINERU_DEVICE_MODE'] = args.device
    from mineru.cli.common import do_parse
    from pypdf import PdfReader

    source = source_path(args.source)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if args.pages_only:
        page_markdown(output)
        return
    page_count = len(PdfReader(source).pages)
    do_parse(str(output), ['document'], [source.read_bytes()], ['ch'],
             backend=args.backend, parse_method='auto', formula_enable=True,
             table_enable=True, f_draw_layout_bbox=False, f_draw_span_bbox=False,
             f_dump_orig_pdf=False, f_dump_md=True, f_dump_middle_json=True,
             f_dump_model_output=True, f_dump_content_list=True)
    page_markdown(output)
    report = {'parser': 'MinerU', 'source_name': source.name,
              'pdf_pages': page_count, 'device': args.device, 'backend': args.backend}
    (output / 'parse-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
