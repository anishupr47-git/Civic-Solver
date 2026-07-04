from django.shortcuts import render
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError
from .models import Category, IssueReport, StatusUpdate
from .serializers import CategorySerializer, IssueReportSerializer, StatusUpdateSerializer
from .services import ReportProcessingService, NotificationService
logger = logging.getLogger('reports')


class CategoryListAPIView(APIView):
    """Categories list API view"""
    def get(self, request, *args, **kwargs):
        logger.info("Getting categories")
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
class IssueReportListCreateAPIView(APIView):
    """Reports list and create API view"""
    def get(self, request, *args, **kwargs):
        logger.info("Getting reports")
        queryset = IssueReport.objects.all()

        # Filter bounds
        lat_min = request.query_params.get('lat_min')
        lat_max = request.query_params.get('lat_max')
        lon_min = request.query_params.get('lon_min')
        lon_max = request.query_params.get('lon_max')

        if all(v is not None for v in [lat_min, lat_max, lon_min, lon_max]):
            try:
                queryset = queryset.filter(
                    latitude__range=(float(lat_min), float(lat_max)),
                    longitude__range=(float(lon_min), float(lon_max))
                )
                logger.debug("Filter bounds applied")
            except ValueError:
                logger.error("Invalid coordinates")
                return Response(
                    {"error": "We need numbers for coordinates"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Filter status
        status_param = request.query_params.get('status')
        if status_param:
            status_list = [s.strip() for s in status_param.split(',')]
            queryset = queryset.filter(status__in=status_list)
            logger.debug("Filter status applied")

        # Filter category
        category_slug= request.query_params.get('category')
        if category_slug:
            queryset = queryset.filter(category__system_slug=category_slug)
            logger.debug("Filter category applied")

        # Filter priority
        priority_param = request.query_params.get('priority')
        if priority_param:
            queryset = queryset.filter(category__priority=priority_param)
            logger.debug("Filter priority applied")

        # Filter agency
        agency_param = request.query_params.get('agency')
        if agency_param:
            queryset = queryset.filter(category__assignment_group=agency_param)
            logger.debug("Filter agency applied")

        # Search text
        search_query = request.query_params.get('search')
        if search_query:
            search_query= search_query.strip()
            queryset = queryset.filter(
                title__icontains=search_query
            ) | queryset.filter(
                description__icontains=search_query
            ) | queryset.filter(
                ticket_number__icontains=search_query
            )
            logger.debug("Search text applied")
        
        # Return serialized data
        serializer = IssueReportSerializer(queryset, many=True, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)
        
    def post(self, request, *args, **kwargs):
        logger.info("Creating report")

        # Get anonymous hash
        anonymous_hash = request.META.get('ANONYMOUS_REPORTER_HASH', 'unknown_signature_hash')

        # Get files
        files = request.FILES.getlist('files')

        # Validate data
        serializer = IssueReportSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            logger.warning("Data validation failed")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Process data
        validated_data = serializer.validated_data

        try:
            report_instance, is_duplicate = ReportProcessingService.create_issue_reports(
                title= validated_data['title'],
                description= validated_data['description'],
                category_id= validated_data['category'].id,
                latitude= validated_data['latitude'],
                longitude= validated_data['longitude'],
                anonymous_reporter_hash=anonymous_hash,
                files=files,
                reported_by=request.user if request.user.is_authenticated else None
            )
        except DjangoValidationError as exc:
            logger.warning("Validation failed")
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as err:
            logger.exception("Unexpected error")
            return Response(
                {"error": "System error"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Return data
        output_serializer = IssueReportSerializer(report_instance, context={'request':request})

        if is_duplicate:
            # Handle duplicate
            logger.info("Duplicate report found")
            return Response({
                "duplicate_matched": True,
                "ticket_number": report_instance.ticket_number,
                "message": f"We already have a report for this place and we added your vote to ticket {report_instance.ticket_number}",

            }, status= status.HTTP_200_OK)
        
        logger.info("Report created")
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

class IssueReportDetailAPIView(APIView):
    """Report detail API view"""
    def get(self, request, pk, *args, **kwargs):
        logger.info("Getting report detail")
        report = get_object_or_404(IssueReport, pk=pk)
        serializer = IssueReportSerializer(report, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    def patch(self, request, pk, *args, **kwargs):
        """Update report status"""
        logger.info("Updating report status")
        report = get_object_or_404(IssueReport, pk=pk)

        # Get params
        new_status = request.data.get('status')
        comment = request.data.get('comment', '').strip()
        admin_notes = request.data.get('administrative_notes','').strip()

        if not new_status:
            return Response(
                {"error": "Please tell us what the status is"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        valid_statuses = [choice[0] for choice in IssueReport.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response(
                {"error": "Please choose a status from the list"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        previous_status = report.status
        if previous_status == new_status:
            return Response(
                {"message": f"Report already resides in state: {new_status}"},
                status=status.HTTP_200_OK
            )
        
        # Save status
        with transaction.atomic():
            locked_report = IssueReport.objects.select_for_update().get(pk=report.pk)
            locked_report.status=new_status
            locked_report.save(update_fields=['status', 'updated_at'])

        # Log transitions
        status_update = StatusUpdate.objects.create(
            report=locked_report,
            previous_status=previous_status,
            new_status=new_status,
            comment=comment or f"We changed the status",
            administrative_notes=admin_notes or "Admin changed the status"

        )
        logger.info("Status updated")
        # Return detail
        serializer = IssueReportSerializer(locked_report, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
class IssueReportUpvoteAPIView(APIView):
    """Report upvote API view"""
    def post(self, request, pk, *args, **kwargs):
        logger.info("Upvoting report")
        report = get_object_or_404(IssueReport, pk=pk)

        # Check if closed
        if report.status in ['Resolved', 'Rejected']:
            logger.warning("Attempted to upvote closed report")
            return Response(
                {"error": "We cannot add votes to closed reports"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        with transaction.atomic():
            locked_report = IssueReport.objects.select_for_update().get(pk=report.pk)
            locked_report.upvote_count +=1
            locked_report.save(update_fields=['upvote_count', 'updated_at'])

            # Add log record
            StatusUpdate.objects.create(
                report=locked_report,
                previous_status=locked_report.status,
                new_status=locked_report.status,
                comment="Another citizen added a vote to this report",
                administrative_notes="One vote added"
            )
            logger.info("Upvote added")

        serializer = IssueReportSerializer(locked_report, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)