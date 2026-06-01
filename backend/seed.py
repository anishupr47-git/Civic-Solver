import os
import django
import random
import datetime

# Configure Django Environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'civic_tracker.settings')
django.setup()

from reports.models import Category, IssueReport, StatusUpdate
from django.contrib.auth.models import User

def seed_database():
    print("Starting civic issue tracker seeding script...")

    # 1. Clean existing records if any
    print("Clearing historical records...")
    StatusUpdate.objects.all().delete()
    IssueReport.objects.all().delete()
    Category.objects.all().delete()

    # Reset SQLite autoincrement sequence counters
    from django.db import connection
    print("Resetting database auto-increment sequences...")
    with connection.cursor() as cursor:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence';")
        if cursor.fetchone():
            cursor.execute("DELETE FROM sqlite_sequence WHERE name='reports_category';")
            cursor.execute("DELETE FROM sqlite_sequence WHERE name='reports_issuereport';")

    # 2. Define standard high-fidelity categories
    categories_data = [
        {
            "name": "Potholes & Road Damage",
            "system_slug": "potholes-road-damage",
            "priority": "Medium",
            "assignment_group": "Public Works",
            "description": "Report street issues including active potholes, severe cracks, broken curbstones, and buckled sidewalk flags."
        },
        {
            "name": "Animal Control Services",
            "system_slug": "animal-control",
            "priority": "Low",
            "assignment_group": "Animal Control",
            "description": "Report animal-related issues including loose aggressive strays, deceased wildlife, or domestic noise disturbances."
        },
        {
            "name": "Traffic Signals & Markings",
            "system_slug": "traffic-signals",
            "priority": "High",
            "assignment_group": "Traffic Safety",
            "description": "Report malfunctioning traffic signals, obscured critical stop signs, broken street lights, or faded crosswalks."
        },
        {
            "name": "Sanitation & Trash Collection",
            "system_slug": "sanitation-trash",
            "priority": "Medium",
            "assignment_group": "Sanitation",
            "description": "Report illegal trash dumps, missed municipal collection zones, overflowing public trash bins, or street sweeps."
        },
        {
            "name": "Hazardous Gas & Power Outages",
            "system_slug": "hazardous-hazards",
            "priority": "High",
            "assignment_group": "Public Works",
            "description": "Report critical safety issues including gas odors, low-hanging downed wires, or active sparking transformers."
        }
    ]

    categories = {}
    for c_data in categories_data:
        cat = Category.objects.create(**c_data)
        categories[c_data['system_slug']] = cat
        print(f"Created category: '{cat.name}' under {cat.assignment_group}")

    # 3. Create mock admin user
    user, created = User.objects.get_or_create(
        username="city_admin", 
        email="admin@metropolis.gov"
    )
    if created:
        user.set_password("metro_pass123")
        user.save()
        print("Mock administrator account 'city_admin' generated.")

    # 4. Zero reports generated for clean production tracker initialization
    print("Clearing mock report entries (Zero reports initialized).")
    print("\nDatabase seeding completed successfully!")

if __name__ == '__main__':
    seed_database()
