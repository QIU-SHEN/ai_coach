"""
Step 1: Extract raw text from product assets using PaddleOCR + PyMuPDF.
Usage: whisper-env/Scripts/python scripts/extract_texts.py [--product 智享喝X6]
Output: scripts/extracted_texts.json + inserts into product_asset_texts table
"""
import os
import sys
import json
import argparse

PRODUCT_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '辅助员工提升销售能力AI员工', '产品资料')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), 'extracted_texts.json')

SKIP_DIRS = {'过往产品'}
SKIP_EXTS = {'.psd', '.ai', '.zip', '.rar', '.7z', '.ds_store', '.thm', '.lrc'}

# Product dir name -> DB product name mapping
DIR_MAP = {
    'HOTSPOT': 'HOTSPOT 即热饮水机',
    'P2太极款': 'P2太极款',
    'REAL3': 'REAL3 净水器',
    'WELL3商用': 'WELL3 商用净水',
    '餐饮微滤机': '餐饮微滤机',
    '爵士H5': '爵士H5 饮水机',
    '名士K2': '名士K2 净水器',
    '名士N5': '名士N5 净水器',
    '力士D8': '力士D8 饮水机',
    '力士T3': '力士T3 饮水机',
    '卫士P2': '卫士P2 净水器',
    '勇士E6-PLUS': '勇士E6-PLUS 商用机',
    '勇士K5': '勇士K5 净水器',
    '小白鲸2.0': '小白鲸2.0 净水器',
    '小蓝鲸3F4F': '小蓝鲸3F/4F 净水器',
    '新款H7': '新款H7 饮水机',
    '直饮机H3': '直饮机H3',
    '直饮机H8': '直饮机H8',
    '智享喝X6': '智享喝X6',
    '台式气泡机': '台式气泡机',
}


def extract_image_text(ocr, filepath):
    """Extract text from image using RapidOCR."""
    try:
        result, _ = ocr(filepath)
        if result:
            lines = [line[1] for line in result]
            return '\n'.join(lines)
        return ''
    except Exception as e:
        print(f'  OCR error: {e}')
        return ''


def extract_pdf_text(filepath):
    """Extract text from PDF using PyMuPDF."""
    try:
        import fitz
        doc = fitz.open(filepath)
        lines = []
        for page in doc:
            text = page.get_text().strip()
            if text:
                lines.append(text)
        doc.close()
        return '\n'.join(lines)
    except Exception as e:
        print(f'  PDF error: {e}')
        return ''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--product', help='Only process this product directory')
    args = parser.parse_args()

    if not os.path.exists(PRODUCT_DIR):
        print(f'Directory not found: {PRODUCT_DIR}')
        sys.exit(1)

    # Init RapidOCR (lightweight, works on Windows)
    print('Initializing RapidOCR...')
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()

    results = []
    total_files = 0
    total_with_text = 0

    product_dirs = sorted(os.listdir(PRODUCT_DIR))
    if args.product:
        product_dirs = [d for d in product_dirs if d == args.product]

    for product_dir in product_dirs:
        product_path = os.path.join(PRODUCT_DIR, product_dir)
        if not os.path.isdir(product_path) or product_dir in SKIP_DIRS:
            continue
        if product_dir not in DIR_MAP:
            print(f'SKIP (no mapping): {product_dir}')
            continue

        product_name = DIR_MAP[product_dir]
        print(f'\nProcessing: {product_dir} -> {product_name}')

        for root, dirs, files in os.walk(product_path):
            for f in sorted(files):
                ext = os.path.splitext(f)[1].lower()
                if ext in SKIP_EXTS:
                    continue

                filepath = os.path.join(root, f)
                relpath = os.path.relpath(filepath, PRODUCT_DIR).replace('\\', '/')
                total_files += 1

                raw_text = ''
                file_type = 'unknown'

                if ext in ('.jpg', '.jpeg', '.png', '.webp'):
                    file_type = 'image'
                    raw_text = extract_image_text(ocr, filepath)
                elif ext == '.pdf':
                    file_type = 'pdf'
                    raw_text = extract_pdf_text(filepath)
                elif ext in ('.mp4', '.avi', '.mov'):
                    file_type = 'video'
                    raw_text = ''
                else:
                    continue

                if raw_text.strip():
                    total_with_text += 1

                results.append({
                    'product': product_name,
                    'product_dir': product_dir,
                    'file': relpath,
                    'file_type': file_type,
                    'raw_text': raw_text,
                })

                status = f'{len(raw_text)} chars' if raw_text.strip() else '(empty)'
                print(f'  [{file_type}] {f}: {status}')

    # Save JSON
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f'\n=== Done ===')
    print(f'Total files: {total_files}')
    print(f'Files with text: {total_with_text}')
    print(f'Output: {OUTPUT_FILE}')


if __name__ == '__main__':
    main()
