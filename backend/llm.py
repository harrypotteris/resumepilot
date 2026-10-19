import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"],
)

resp = client.chat.completions.create(
    model=os.environ["NVIDIA_MODEL"],
    messages=[
        {"role": "user", "content": 'Reply with only this JSON: {"ok": true}'}
    ],
    temperature=0,
    max_tokens=100,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
)
print(resp.choices[0].message.content)