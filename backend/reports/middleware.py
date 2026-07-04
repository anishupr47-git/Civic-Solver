import time
import hashlib
import logging
import threading
from django.http import JsonResponse

logger = logging.getLogger('reports')

class RateLimitAndAnonymizationMiddleware:
    """Rate limit and anonymization middleware"""
    def __init__(self,get_response):
        self.get_response = get_response
        # Set up logs
        self.write_request_logs = {}
        self.general_request_logs = {}
        self.lock = threading.Lock()

        # limit rates settings
        self.WRITE_LIMIT = 6
        self.GENERAL_LIMIT = 100
        self.WINDOW_SIZE = 60

    def _get_client_ip(self, request):
        """Get IP address"""
        # Check Cloudflare
        cf_connecting_ip = request.META.get('HTTP_CF_CONNECTING_IP')
        if cf_connecting_ip:
            return cf_connecting_ip.strip()

        # Check real IP
        x_real_ip = request.META.get('HTTP_X_REAL_IP')
        if x_real_ip:
            return x_real_ip.strip()

        # Check Forwarded For
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()

        # Fallback IP
        return request.META.get('REMOTE_ADDR', '127.0.0.1')

    
    def _calculate_reporter_hash(self, ip, user_agent):
        """Make IP hash"""
        data = f"{ip}:{user_agent}:CIVIC_SALT_98745".encode('utf-8')
        return hashlib.sha256(data).hexdigest()
    
    def _is_rate_limited(self, log_dict, signature, limit_threshold):
        """Check rate limits"""
        now = time.time()
        cutoff = now - self.WINDOW_SIZE

        with self.lock:
            # Set up logs
            if signature not in log_dict:
                log_dict[signature] = []

            # Delete old logs
            log_dict[signature] = [t for t in log_dict[signature] if t > cutoff]

            history = log_dict[signature]
            current_count = len(history)

            if current_count >= limit_threshold:
                if current_count > 0:
                    oldest_timestamp = history[0]
                    reset_time = max(0, int(self.WINDOW_SIZE - (now - oldest_timestamp)))
                else:
                    reset_time = 0
                logger.warning("Rate limit exceeded")
                return True, 0, reset_time

            # Add log time
            log_dict[signature].append(now)
            new_count = current_count + 1
            remaining = max(0, limit_threshold - new_count)

            oldest_timestamp = log_dict[signature][0]
            reset_time = max(0, int(self.WINDOW_SIZE - (now - oldest_timestamp)))

            return False, remaining, reset_time
            
    def __call__(self, request):
        # Skip Admin
        if 'admin' in request.path:
            return self.get_response(request)

        # Only check api
        if not request.path.startswith('/api/'):
            return self.get_response(request)

        # Get IP and user agent
        client_ip = self._get_client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', 'unknown_agent')

        # Make hash
        anonymized_signature = self._calculate_reporter_hash(client_ip, user_agent)

        # Add headers
        request.META['ANONYMOUS_REPORTER_HASH'] = anonymized_signature
        request.META['HTTP_X_CLIENT_SIGNATURE'] = anonymized_signature

        # Check rates
        is_write = request.method in ['POST', 'PUT', 'PATCH', 'DELETE']

        # Find limit
        if is_write:
            limited, remaining, reset_in = self._is_rate_limited(
                self.write_request_logs, anonymized_signature, self.WRITE_LIMIT
            )
            limit_max = self.WRITE_LIMIT
        else:
            limited, remaining, reset_in = self._is_rate_limited(
                self.general_request_logs, anonymized_signature, self.GENERAL_LIMIT
            )
            limit_max = self.GENERAL_LIMIT

        # If rate limited
        if limited:
            response=JsonResponse({
                "error": "Please wait. Too many hits",
                "message": f"Please retry in {reset_in} seconds"
            }, status=429)

            response['rem']='0'
            response['rst']=str(reset_in)
            response['sig']= anonymized_signature
            response['anon']= 'True'
            return response
        
        # Keep private
        if 'HTTP_COOKIE' in request.META:
            # Remove cookies
            logger.debug("Scrubbing cookies")
            del request.META['HTTP_COOKIE']

        # Call next handler
        response = self.get_response(request)

        # Add security headers
        response['sig']= anonymized_signature
        response['anon']= 'True'
        response['rem']= str(remaining)
        response['rst']= str(reset_in)

        return response
