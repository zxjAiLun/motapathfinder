main.floors.MT347=
{
    "floorId": "MT347",
    "title": "347 层",
    "name": "347 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 2000000,
    "defaultGround": 906,
    "bgm": "20.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "var lastTime = core.getFlag('lastTime', 0);\n\nif (Date.now() - lastTime > 20) {\n\tvar image = core.material.images.images['03.png'];\n\tvar width = 416,\n\t\theight = 416;\n\n\tcore.canvas.bg.translate(width / 2, height / 2);\n\tcore.canvas.bg.rotate(Math.PI / 180 / 6);\n\tcore.canvas.bg.translate(-width / 2, -height / 2);\n\tcore.canvas.bg.drawImage(image, -288, -96);\n\n\tcore.setFlag('lastTime', Date.now());\n\n\tvar rotateTime = core.getFlag('rotateTime', 0);\n\trotateTime += 1;\n\tif (rotateTime >= 6 * 180) {\n\t\trotateTime -= 6 * 180;\n\t}\n\tcore.setFlag('rotateTime', rotateTime);\n}",
    "events": {},
    "changeFloor": {
        "11,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "4,1": {
            "floorId": "MT346",
            "loc": [
                9,
                4
            ]
        },
        "4,11": {
            "floorId": "MT348",
            "loc": [
                6,
                7
            ]
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
    [1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035],
    [1035,639,1035,1035,991,619,1006, 82,640,1035,1035, 88,1035],
    [1035,  0,1035,1035,1035,1035,1235,1035,1035,1035,1035,621,1035],
    [1035,1234,1035,1035,  0, 16,620,  0,1035,1035,1035,1233,1035],
    [1035,619,1035,1035,642,1035,1007,620,1035,1035,1035,1007,1035],
    [1035,621,1035,1035,1035,1035,1035,1035,1035,1035,1035,1006,1035],
    [1035,1235,1035,1035,1035,1035,1035,636,1035,1035,1035, 50,1035],
    [1035,638,1035,1035,621,1235,635, 81,637,1035,1035,1233,1035],
    [1035, 82,1035,1035,1035,1035, 15,1035,1035,1035,1035, 82,1035],
    [1035,1234,1035,1035, 47,1035,  0,619,1035,1035,1035,621,1035],
    [1035,  0, 86, 86,  0, 81,1236,635,1035,1035,1035,1232,1035],
    [1035,639,1035,1035,992,1035,620,  0,640,1035,1035, 87,1035],
    [1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035]
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