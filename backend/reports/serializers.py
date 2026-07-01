import logging
from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Category, IssueReport, StatusUpdate, MediaAttachment

logger = logging.getLogger('reports')

class CategorySerializer(serializers.ModelSerializer):
    """
    supporting read write operations
    """
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    assignment_group_display = serializers.CharField(source='get_assignment_group_display', read_only = True)

    class Meta:
        model = Category
        fields = [
            'id',
            'name',
            'system_slug',
            'priority',
            "priority_display",
            'assignment_group',
            'assignment_group_display',
            'description'
        ]

class MediaAttachmentSerializer(serializers.ModelSerializer):
    """
    serializer for mediaattachmentserializersss
    """
    absolute_url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAttachment
        fields = [
            'id',
            'file_path',
            'absolute_url',
            'file_size',
            'mime_type',
            'uploaded_at'
        ]

    def get_absolute_url(self, obj):
        """Builds and returns fully qualified absolute target URLs for attachments"""
        request = self.context.get('request')
        if obj.file_path:
            if request is not None:
                return request.build_absolute_uri(obj.file_path.url)
            return obj.file_path.url
        return None
    
class StatusUpdateSerializer(serializers.ModelSerializer):
    """
    for ticket and transition and also status check
    """
    previous_status_display = serializers.CharField(source='get_previous_status_display', read_only=True)
    new_status_display = serializers.CharField(source='get_new_status_display', read_only=True)

    class Meta:
        model = StatusUpdate
        fields = [
            'id',
            'previous_status',
            'previous_status_display',
            'new_status',
            'new_status_display',
            'comment',
            'administrative_notes',
            'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class IssueReportSerializer(serializers.ModelSerializer):
    """
    issue report and submit report
    """
    category_detail = CategorySerializer(source='category', read_only=True)
    media_attachments = MediaAttachmentSerializer(many=True, read_only=True)
    history_logs = StatusUpdateSerializer(many=True, read_only=True)
    status_display= serializers.CharField(source='get_status_display', read_only=True)
    reporter_username = serializers.SerializerMethodField()

    class Meta:
        model = IssueReport
        fields = [
            'id',
            'ticket_number',
            'title',
            'description',
            'category',
            'category_detail',
            'latitude',
            'longitude',
            'status',
            'status_display',
            'automated_priority_override',
            'reporter_username',
            'anonymous_reporter_hash',
            'upvote_count',
            'media_attachments',
            'history_logs',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'ticket_number',
            'status',
            'automated_priority_override',
            'anonymous_reporter_hash',
            'upvote_count',
            'media_attachments',
            'history_logs',
            'created_at',
            'updated_at',
        ]

    def get_reporter_username(self,obj):
        """Displays reporter name is registered"""
        if obj.reported_by:
            return obj.reported_by.username
        return "Anonymous Citizen"
    
    def validate_title(self, value):
        """Ensures report tile  with municipal criteria"""
        trimmed = value.strip()
        if len(trimmed) < 5:
            logger.warning(f"Validation failure on report title: '{trimmed}' too short")
            raise serializers.ValidationError("Issue title must be atleast 5 character long")
        if len(trimmed) > 150:
            logger.warning(f"Validation failure on report title: exceeds 150 characters")
            raise serializers.ValidationError("Issue title cannot exceed 150 characters")
        
        #Simple spam word filters
        spam_words = ["testtest", "spamspam", "asdfasdf", "junkstuff"]
        for spam in spam_words:
            if spam in trimmed.lower():
                logger.warning(f"Potential spam detected in title: {trimmed}")
                raise serializers.ValidationError("Title contains spam content")
        return trimmed
        
    def validate_description(self, value):
        """validate description"""
        trimmed = value.strip()
        if len(trimmed) < 15:
            logger.warning(f"Validation failure on description length: '{trimmed}' too short")
            raise serializers.ValidationError("Description must contain at least 15 characters of diagnostic details")
        return trimmed
    
    def validate(self, data):
        """
        Validate coordinate points and cross-check
        """

        lat = data.get('latitude')
        lon = data.get('longitude')

        if lat is not None and not (-90.0 <= lat <= 90.0):
            raise serializers.ValidationError({
                "latitude": "Latitude coordinates must reside within [-90.0, 90.0]"
            })
        if lon is not None and not (-180.0 <= lon <= 180.0):
            raise serializers.ValidationError({
                "longitude": "Longitude coordinates must reside within [-180.0, 180.0]"
            })
        
        return data