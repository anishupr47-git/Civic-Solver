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
# Create your views here.


class CategoryListAPIView(APIView):
    """
    API endpoint listing all available civic classification categories.
    Used by frontend clients
    """
    def get(self, request, *args, **kwargs):
        logger.info("CategoryListAPIView - Fetching list of all civic categories")
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
class IssueReportListCreateAPIView(APIView):
    """
    API endpoint to list filtered issue reports (GET) and register new (POST)
    """
    def get(self, request, *args, **kwargs):
        logger.info("IssueReportListCreateAPIView GET- Fetching filtered issue list")
        queryset = IssueReport.objects.all()

        #1. Bounding Box Geospatial Filter
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
                logger.debug(f"Applied spatial box query: Lat[{lat_min}, {lat_max}], Lon[{lon_min}, {lon_max}]")
            except ValueError:
                logger.error("Spatial coordinate filter parameters are not valid floats.")
                return Response(
                    {"error": "Spatial bounding values must be numeric float coordinates."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        #2 Remediation status filtering
        status_param = request.query_params.get('status')
        if status_param:
            status_list = [s.strip() for s in status_param.split(',')]
            queryset = queryset.filter(status__in=status_list)
            logger.debug(f"Applied status filters: {status_list}")

        #3 Category system slug filtering
        category_slug= request.query_params.get('category')
        if category_slug:
            queryset = queryset.filter(category__system_slug=category_slug)
            logger.debug(f"Applied category filter: {category_slug}")

        #4 Priority Tier Filtering
        priority_param = request.query_params.get('priority')
        if priority_param:
            queryset = queryset.filter(category__priority=priority_param)
            logger.debug(f"Applied category priority filter: {priority_param}")

        #5 Assignment group filtering
        agency_param = request.query_params.get('agency')
        if agency_param:
            queryset = queryset.filter(category__assignment_group=agency_param)
            logger.debug(f"Applied agency assignment group filter: {agency_param}")

        #6 Global Text Query Searching
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
            logger.debug(f"Applied query text search parameter: '{search_query}'")
        
        #Serialize results and output
        serializer = IssueReportSerializer(queryset, many=True, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)
        
    def post(self, request, *args, **kwargs):
        logger.info("IssueReportListCreateAPIVIEW POST - Regestering new citizen civic incident")

        #EXTRACT ANOYMIZED HAS INJECTED BY MIDDLEWARE
        anonymous_hash = request.META.get('ANONYMOUS_REPORTER_HASH', 'unknown_signature_hash')

        #WE EXTRACT FILES IF MULTIPART FROM UPLOAD WAS TRIGGERED
        files = request.FILES.getlist('files')

        # Leverage standard serializer validator for input scrubbing
        serializer = IssueReportSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            logger.warning(f"Validation failures on submission data: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # DELEGATE VALIDATION, DUPLIACE MATCHING OVERIDE AND DB COMMITS TO SERVICES
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
            logger.warning(f"Business constraint validation failure: {exc.message}")
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as err:
            logger.exception(f"Unexpected crash in processing service pipelines: {err}")
            return Response(
                {"error": "Municipal pipeline encountered an unrecoverable system exception"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        #Build output payload
        output_serializer = IssueReportSerializer(report_instance, context={'request':request})

        if is_duplicate:
            #Duplicate successfully
            logger.info(f"Report identified as duplicate. Response linked to {report_instance}")
            return Response({
                "duplicate_matched": True,
                "ticket_number": report_instance.ticket_number,
                "message": f"An active report already covers this coordinate space within 48 hours. Ticket {report_instance.ticket_number} upvote instead",

            }, status= status.HTTP_200_OK)
        
        logger.info(f"Unique report registered successfully. Ticket: {report_instance.ticket_number}")
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

class IssueReportDetailAPIView(APIView):
    """
    API endpoint handling targeted retrievals, details (GET) and administrative state mutations (PATCH) for individual ticket objects
    """
    def get(self, request, pk, *args, **kwargs):
        logger.info(f"IssueReportDetailAPIView GET - FETCHING details for ticket ID {pk}")
        report = get_object_or_404(IssueReport, pk=pk)
        serializer = IssueReportSerializer(report, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    def patch(self, request, pk, *args, **kwargs):
        """
        Allows administrative transitions for status
        """
        logger.info(f"IssueReportDetailAPIView PATCH - Modifying status parameters for ticket ID {pk}")
        report = get_object_or_404(IssueReport, pk=pk)

        #Parse request payload keys
        new_status = request.data.get('status')
        comment = request.data.get('comment', '').strip()
        admin_notes = request.data.get('administrative_notes','').strip()

        if not new_status:
            return Response(
                {"error": "Transition require a valid target 'status' field"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        valid_statuses = [choice[0] for choice in IssueReport.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response(
                {"error": f"Invalid status selection. Choose from: {valid_statuses}"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        previous_status = report.status
        if previous_status == new_status:
            return Response(
                {"message": f"Report already resides in state: {new_status}"},
                status=status.HTTP_200_OK
            )
        
        #Process modification transactional boundary
        with transaction.atomic():
            locked_report = IssueReport.objects.select_for_update().get(pk=report.pk)
            locked_report.status=new_status
            locked_report.save(update_fields=['status', 'updated_at'])

        #Log audit record
        status_update = StatusUpdate.objects.create(
            report=locked_report,
            previous_status=previous_status,
            new_status=new_status,
            comment=comment or f"Municipal status transition: {previous_status} -> {new_status}",
            administrative_notes=admin_notes or "Administrative state change logged"

        )
        logger.info(
            f"[TRANSITION] Incident {locked_report.ticket_number} moved from {previous_status} to {new_status}"
        )
        #Reserialize full ticket output
        serializer = IssueReportSerializer(locked_report, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    
class IssueReportUpvoteAPIView(APIView):
    """
    API endpoint securely increasing citizen validation upvote counts for specific issues
    """
    def post(self, request, pk, *args, **kwargs):
        logger.info(f"IssueReportUpvoteAPIView POST - Adding citizen upvote for ticket ID {pk}")
        report = get_object_or_404(IssueReport, pk=pk)

        #Ensure tickets cannot be upvoted if already closed/resolved
        if report.status in ['Resolved', 'Rejected']:
            logger.warning(f"Attempted to upvote closed/archived ticket {report.ticket_number}")
            return Response(
                {"error": "Upvotes cannot be applied to tickets that are Resolved or Rejected"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        with transaction.atomic():
            locked_report = IssueReport.objects.select_for_update().get(pk=report.pk)
            locked_report.upvote_count +=1
            locked_report.save(update_fields=['upvote_count', 'updated_at'])

            #Add status audit history item
            StatusUpdate.objects.create(
                report=locked_report,
                previous_status=locked_report.status,
                new_status=locked_report.status,
                comment="A citizen validated and upvoted this reported issue",
                administrative_notes="Upvote API endpoint invoked successfully"
            )
            logger.info(f"[UPVOTED] Ticket {locked_report.ticket_number} reached {locked_report.upvote_count} upvotes")

        serializer = IssueReportSerializer(locked_report, context={'request':request})
        return Response(serializer.data, status=status.HTTP_200_OK)