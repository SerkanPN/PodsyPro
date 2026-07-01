with open('main.py', 'a', encoding='utf-8') as f:
    f.write('\n\nif __name__ == "__main__":\n    import uvicorn\n    uvicorn.run(app, host="127.0.0.1", port=8000)\n')
