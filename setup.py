from setuptools import setup, find_packages

setup(
    name="sadie",
    version="0.1.0",
    description="Sadie - A fully local AI assistant for Windows",
    author="kingithegreat",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.8",
    install_requires=[
        "pyqt5>=5.15.0",
        "requests>=2.31.0",
        "pillow>=10.0.0",
        "pytesseract>=0.3.10",
        "python-dotenv>=1.0.0",
        "openai-whisper>=20230314",
        "sounddevice>=0.4.6",
        "soundfile>=0.12.1",
        "watchdog>=3.0.0",
        "opencv-python>=4.8.0",
        "numpy>=1.24.0",
        "aiohttp>=3.9.0",
        "pyyaml>=6.0",
    ],
    entry_points={
        "console_scripts": [
            "sadie=sadie.main:main",
        ],
    },
)
