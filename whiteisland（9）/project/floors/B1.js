main.floors.B1=
{
    "floorId": "B1",
    "title": "魔法屋",
    "name": "魔法屋",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 60015,
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "1,8": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n500生命，2攻击。",
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
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "400"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "2"
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
        "8,9": {
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
    [160,160,160,160,160,160,160,160,160,160,160,160,160],
    [160, 27,  0, 32,160, 28,160,  0,202,  0,160,576,160],
    [160,  0, 22,  0,207,  0,216, 31,160, 29,  0,215,160],
    [160,160, 81,160, 82,160,160,160,160,160,206,160,160],
    [160, 29,212,160, 29,160, 31,160, 21,160,  0, 32,160],
    [160,160,  0,203,  0,206,  0, 86,204, 86,207,160,160],
    [160, 28,204,160, 21,160, 31,160, 21,160,  0, 27,160],
    [160,160,160,160,210,160,160,160,160,160,160, 82,160],
    [160, 89,160, 27,  0,202,160,  0, 21,  0,160,  0,160],
    [160,  0,160, 81,160, 31,160, 31, 87, 22,160,201,160],
    [160, 86,160,  0,201,  0,203,  0, 31,203,  0, 31,160],
    [160, 21,201, 31,160, 31,160, 28,160,  0, 27,  0,160],
    [160,160,160,160,160,160,160,160,160,160,160,160,160]
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