import os
import sys

# Set up paths relative to this file
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

# Set the Django settings module environment variable
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'civic_tracker.settings')

# Import the WSGI application callable from Django's wsgi file
from civic_tracker.wsgi import application
