#!/usr/bin/env python3
# UTF-8 安全截断工具
import sys

def truncate(text, max_chars):
    """按字符截断文本，不切断多字节 UTF-8 字符"""
    try:
        # 确保输入是字符串
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='ignore')
        # 按字符截断
        return text[:max_chars]
    except:
        return text[:max_chars] if len(text) > max_chars else text

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 utf8_truncate.py MAX_CHARS", file=sys.stderr)
        sys.exit(1)

    max_chars = int(sys.argv[1])
    # 从 stdin 读取
    text = sys.stdin.read()
    result = truncate(text, max_chars)
    # 输出为 UTF-8
    sys.stdout.write(result)
