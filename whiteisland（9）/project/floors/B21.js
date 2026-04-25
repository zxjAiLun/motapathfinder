main.floors.B21=
{
    "floorId": "B21",
    "title": "含盐地",
    "name": "含盐地",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2,
    "defaultGround": 70017,
    "bgm": "3.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "1,11": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n3攻击，3防御。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "6,1": {
            "floorId": ":next",
            "stair": "downFloor"
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
    [155,155,155,155,155,155,155,155,155,155,155,155,155],
    [155, 27,  0,155, 28,155, 87,155,155, 28,155, 30,155],
    [155,155,275,155,  0,155,  0,155, 29,  0, 34,277,155],
    [155, 22,  0,255, 29, 81, 21, 82,275, 21,279,  0,155],
    [155,155, 81,155,155,155,253,155,155,155, 81,155,155],
    [155, 28,  0, 32,155, 28,  0, 29, 81, 32,  0, 32,155],
    [155,155,155,252,155,155,155,254,155,155,155,252,155],
    [155,254,  0, 27, 81, 21,253,  0,155, 27,  0, 31,155],
    [155,  0,155,155,155, 81,155,155,155,255,155,155,155],
    [155,252,155,251, 82, 28,  0, 81, 21,  0,253, 27,155],
    [155,  0, 21,  0,155,155,271,155,155,272, 82,155,155],
    [155, 89,  0, 30,155, 29,  0,155, 30,  0,271, 27,155],
    [155,155, 22,155,155,155,155,155,155,155,155,155,155]
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