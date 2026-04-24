main.floors.MT349=
{
    "floorId": "MT349",
    "title": "349 层",
    "name": "349 层",
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
    "events": {
        "1,1": {
            "trigger": "action",
            "enable": true,
            "noPass": null,
            "displayDamage": true,
            "opacity": 1,
            "filter": {
                "blur": 0,
                "hue": 0,
                "grayscale": 0,
                "invert": false,
                "shadow": 0
            },
            "data": [
                {
                    "type": "if",
                    "condition": "(flag:350f==0)",
                    "true": [
                        {
                            "type": "setCurtain",
                            "color": [
                                0,
                                0,
                                0,
                                1
                            ],
                            "time": 1000,
                            "keep": true
                        },
                        {
                            "type": "setValue",
                            "name": "flag:350f",
                            "value": "1"
                        },
                        {
                            "type": "changeFloor",
                            "floorId": "MT350",
                            "loc": [
                                6,
                                3
                            ],
                            "direction": "down"
                        }
                    ],
                    "false": [
                        {
                            "type": "changeFloor",
                            "floorId": "MT350",
                            "loc": [
                                6,
                                3
                            ],
                            "direction": "down"
                        }
                    ]
                }
            ]
        }
    },
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "3,1": {
            "floorId": "MT346",
            "loc": [
                6,
                9
            ]
        },
        "11,4": {
            "floorId": "MT348",
            "loc": [
                6,
                3
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
    [1035, 87,1035,904,1035,1035,643,1035,639,1235,  0,1006,1035],
    [1035,1235,1035,635,1035,1035,1236,1035,620,1035,1035, 15,1035],
    [1035,  0,1035,  0,1035,1035, 16,1035, 16,1035,622,  0,1035],
    [1035,1234, 15,1236,1035,1035,621,1230,  0,1035,  0,993,1035],
    [1035, 83,1035,638,1035,1035, 16,1035,1035,1035,1236,1035,1035],
    [1035,636,1035,619,1035,1035,  0,1007,1035,621,  0,642,1035],
    [1035,  0,1234,638,1035,1035,1233,  0, 83, 86,1035, 83,1035],
    [1035,1232,1035,1035,1035,1035, 82,1035,1035,1235,1035,619,1035],
    [1035,  0,621,1035,1035,1035,1234,620,1035,  0,1035,1230,1035],
    [1035,1233,1035,1035,1035,1035,1035,  0,1035,1234,1035,  0,1035],
    [1035, 88,619,636,1035,1035,1035,642,1236,  0,1236,644,1035],
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