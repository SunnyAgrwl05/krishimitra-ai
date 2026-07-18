FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Train models at build time so the image is ready to serve immediately
RUN python3 model/generate_training_data.py && python3 model/train_model.py

EXPOSE 5000
ENV PORT=5000

CMD ["python3", "app.py"]
