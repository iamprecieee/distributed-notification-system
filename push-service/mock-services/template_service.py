from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

TEMPLATES = {
    "welcome_notification": {
        "id": "tmpl_001",
        "code": "welcome_notification",
        "type": "push",
        "language": "en",
        "version": 1,
        "content": {
            "title": "Welcome {{name}}!",
            "body": "Hi {{name}}, thanks for joining us!",
        },
        "variables": ["name"],
    },
    "TEST_TEMPLATE": {
        "id": "tmpl_002",
        "code": "TEST_TEMPLATE",
        "type": "push",
        "language": "en",
        "version": 1,
        "content": {
            "title": "Test Notification",
            "body": "This is a test: {{test_key}}",
        },
        "variables": ["test_key"],
    },
    "order_shipped": {
        "id": "tmpl_003",
        "code": "order_shipped",
        "type": "push",
        "language": "en",
        "version": 1,
        "content": {
            "title": "Order Shipped!",
            "body": "Your order {{order_id}} has been shipped. Track it here: {{tracking_link}}",
        },
        "variables": ["order_id", "tracking_link"],
    },
}


@app.route("/api/v1/templates/<template_code>", methods=["GET"])
def get_template(template_code):
    language = request.args.get("lang", "en")

    template = TEMPLATES.get(template_code)

    if not template:
        return jsonify({"error": "Template not found"}), 404

    if template["language"] != language:
        return jsonify(
            {"error": f"Template not available in language: {language}"}
        ), 404

    return jsonify(template), 200


if __name__ == "__main__":
    print("Template Service Mock starting on http://localhost:8001")
    app.run(host="0.0.0.0", port=8001, debug=True)
