main.floors.MT781=
{
    "floorId": "MT781",
    "title": "781 层",
    "name": "781 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "14.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0,
            "sx": 150,
            "sy": 150
        }
    ],
    "ratio": 20000000000000,
    "defaultGround": 906,
    "bgm": "41.mp3",
    "firstArrive": [
        {
            "type": "setValue",
            "name": "flag:wlzt",
            "value": "0"
        },
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    1
                ]
            ],
            "floorId": "MT759",
            "remove": true
        },
        {
            "type": "hide",
            "loc": [
                [
                    10,
                    10
                ]
            ],
            "floorId": "MT772",
            "remove": true
        },
        {
            "type": "disableShop",
            "id": "T1"
        },
        {
            "type": "disableShop",
            "id": "T2"
        }
    ],
    "eachArrive": [],
    "parallelDo": "var lastTime = core.getFlag('lastTime', 0);\n\nif (Date.now() - lastTime > 20) {\n\tvar image = core.material.images.images['14.jpg'];\n\tvar width = 416,\n\t\theight = 416;\n\n\tcore.canvas.bg.translate(width / 2, height / 2);\n\tcore.canvas.bg.rotate(Math.PI / 180 / 6);\n\tcore.canvas.bg.translate(-width / 2, -height / 2);\n\tcore.canvas.bg.drawImage(image, -288, -96);\n\n\tcore.setFlag('lastTime', Date.now());\n\n\tvar rotateTime = core.getFlag('rotateTime', 0);\n\trotateTime += 1;\n\tif (rotateTime >= 6 * 180) {\n\t\trotateTime -= 6 * 180;\n\t}\n\tcore.setFlag('rotateTime', rotateTime);\n}",
    "events": {},
    "changeFloor": {
        "6,12": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "6,0": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  0,  0,  0,  0,  0,  0, 88,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0, 87,  0,  0,  0,  0,  0,  0]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}