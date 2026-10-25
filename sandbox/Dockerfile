# Python の実行環境（ADR 0038）。ネットワークなし・読み取り専用・非 root で動かす（compose 側で強制）
FROM python:3.12-slim

# データ分析の定番。いずれも BSD-3-Clause / MIT 系（docs/licenses/）。バージョンは範囲で固定する
RUN pip install --no-cache-dir \
      "numpy>=2.0,<3" "pandas>=2.2,<3" "scipy>=1.13,<2" "matplotlib>=3.9,<4" \
      "scikit-learn>=1.5,<2" "openpyxl>=3.1,<4"

COPY runner.py /opt/runner.py
USER 1000:1000
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "-I", "/opt/runner.py"]
