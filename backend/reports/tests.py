from django.test import TestCase
import datetime
from django.core.exceptions import ValidationError
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from reports.models import Category, IssueReport, StatusUpdate
from reports.services import ReportProcessingService, NotificationService

class CivicIssueTrackerTestCase(TestCase):
    """Test model and service bounds"""
    def setUp(self):
        # Add mock categories
        self.road_category = Category.objects.create(
            name="Road Hazards & Damage",
            system_slug="road-hazards-damage",
            priority="Medium",
            assignment_group="Public Works",
            description="Potholes and broken curbstones"
        )
        self.hazards_category = Category.objects.create(
            name="Hazardous Conditions",
            system_slug="hazardous-conditions",
            priority="High",
            assignment_group="Public Works",
            description="Low hanging downed power wires or gas odors"
        )

    def test_category_string_representation(self):
        """Test category text"""
        self.assertEqual(
            str(self.road_category),
            "Road Hazards & Damage (Medium worry - Road fixers)"
        )

    def test_geospatial_bounds_validation(self):
        """Test map coordinates"""
        # Inside city limits
        valid_lat = 40.7500
        valid_lon = -73.9500

        # Should work fine
        try:
            ReportProcessingService.validate_geospatial_bounds(valid_lat, valid_lon)
        except ValidationError:
            self.fail("Validate coordinates failed unexpectedly")

        # Too far north
        with self.assertRaises(ValidationError):
            ReportProcessingService.validate_geospatial_bounds(40.9000, valid_lon)

        # Too far west
        with self.assertRaises(ValidationError):
            ReportProcessingService.validate_geospatial_bounds(valid_lat, -74.1500)

    def test_ai_urgency_override_classification(self):
        """Test AI override scan"""
        # Test match triggers
        self.assertTrue(
            ReportProcessingService.calculate_ai_urgency_override(
                "Gas leak detected", "Gas smell is emerging from the pipe"
            )
        )
        self.assertTrue(
            ReportProcessingService.calculate_ai_urgency_override(
                "Downed wire sparking", "High voltage electric power lines collapsed on fence"
            )
        )

        # Test normal text
        self.assertFalse(
            ReportProcessingService.calculate_ai_urgency_override(
                "Need paint on bike path", "The lanes have faded slightly and need new markings"
            )
        )

    def test_deduplication_engine_aggregates_upvotes(self):
        """Test duplicates add upvotes"""
        # Create report
        base_report, is_dup_first = ReportProcessingService.create_issue_reports(
            title="Pothole on Main St",
            description="Deep pothole in the second lane, causing cars to swerve",
            category_id=self.road_category.id,
            latitude=40.7300,
            longitude=-73.900,
            anonymous_reporter_hash="original_reporter_hash"
        )

        # Create duplicate report
        # Coordinate shift
        dup_report_instance, is_dup = ReportProcessingService.create_issue_reports(
            title="Massive road hole on Main St",
            description="Another report of the same pothole near intersection",
            category_id=self.road_category.id,
            latitude=40.7302,
            longitude=-73.9005,
            anonymous_reporter_hash="citizen_test_hash"
        )

        self.assertTrue(is_dup)
        self.assertEqual(dup_report_instance.id, base_report.id)
        base_report.refresh_from_db()
        self.assertEqual(base_report.upvote_count, 2)

class CivicIssueTrackerAPITestCase(APITestCase):
    """Test API views"""

    def setUp(self):
        """Setup category"""
        self.category = Category.objects.create(
            name="Sanitation Services",
            system_slug="saniation-services",
            priority="Low",
            assignment_group="Sanitation",
            description="Trash and clean sweeps"
        )

        # Setup report
        self.report = IssueReport.objects.create(
            title="Overflowing Dumpster in Parkway",
            description="Commercial garbag container overflowing with wood crates",
            category= self.category,
            latitude=40.7600,
            longitude=-73.9300,
            anonymous_reporter_hash="init_test_client_signature",
            upvote_count=5
        )
    def test_list_categories_endpoint(self):
        """Test categories list API"""
        response = self.client.get('/api/categories/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['name'], "Sanitation Services")

    def test_list_reports_endpoint_with_filters(self):
        """Test filtered reports list API"""
        # Get all reports
        response = self.client.get('/api/reports/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

        # Filter by coordinates
        response = self.client.get('/api/reports/?lat_min=40.7500&lat_max=40.7700&lon_min=-73.9400&lon_max=-73.9200')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

        # Filter outside coordinates
        response = self.client.get('/api/reports/?lat_min=40.7000&lat_max=40.7200&lon_min=-74.0500&lon_max=-74.0300')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_upvote_ticket_endpoint(self):
        """Test upvote endpoint"""
        response = self.client.post(f'/api/reports/{self.report.id}/upvote/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['upvote_count'], 6)

        self.report.refresh_from_db()
        self.assertEqual(self.report.upvote_count,6)

    def test_administrative_status_transition_patch(self):
        """Test transition endpoint"""
        payload = {
            "status": "In Progress",
            "comment": "Maintenance Truck #14 dispatched to empty park dumpster",
            "administrative_notes": "State transitioned by city dispatcher"
        }

        response = self.client.patch(f'/api/reports/{self.report.id}/', data=payload)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], "In Progress")

        # Verify log recorded
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "In Progress")

        latest_log = StatusUpdate.objects.filter(report=self.report).last()
        self.assertEqual(latest_log.previous_status, "Open")
        self.assertEqual(latest_log.new_status, "In Progress")
        self.assertEqual(latest_log.comment, "Maintenance Truck #14 dispatched to empty park dumpster")
        self.assertEqual(latest_log.administrative_notes, "State transitioned by city dispatcher")
